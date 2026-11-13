//! Command Code 本地模型路由。
//!
//! `router/<槽位>` 进入这里，按槽位里的候选优先级依次尝试上游（都是 anthropic-messages，
//! 纯透传，只把请求体里的 `model` 换成候选的模型 id）。首字节之前的失败会自动换下一家：
//! 连接失败 / 超时 / 429 / 5xx / 404 模型不存在。401/403 直接冻结整个供应商 60 秒。
//! 连续失败 4 次同样冻结 60 秒，和现有代理的熔断参数一致。
use crate::commandcode_config;
use crate::database::Database;
use axum::{
    body::Body,
    extract::{DefaultBodyLimit, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::Response,
    routing::post,
    Router,
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};

const PREFERRED_PORT: u16 = 17899;
const MAX_ATTEMPTS: usize = 4;
const FIRST_BYTE_TIMEOUT: Duration = Duration::from_secs(60);
const FREEZE: Duration = Duration::from_secs(60);
const FAILURE_THRESHOLD: u32 = 4;

#[derive(Clone)]
struct Ctx {
    db: Arc<Database>,
}

struct Handle {
    #[allow(dead_code)]
    port: u16,
    shutdown: tokio::sync::oneshot::Sender<()>,
}

fn handle_slot() -> &'static Mutex<Option<Handle>> {
    static HANDLE: OnceLock<Mutex<Option<Handle>>> = OnceLock::new();
    HANDLE.get_or_init(|| Mutex::new(None))
}

fn freeze_slot() -> &'static Mutex<HashMap<String, (Instant, u32)>> {
    static FREEZE_MAP: OnceLock<Mutex<HashMap<String, (Instant, u32)>>> = OnceLock::new();
    FREEZE_MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_frozen(provider_id: &str) -> bool {
    let mut map = freeze_slot().lock().unwrap_or_else(|e| e.into_inner());
    match map.get(provider_id) {
        Some((until, _)) if *until > Instant::now() => true,
        Some(_) => {
            map.remove(provider_id);
            false
        }
        None => false,
    }
}

fn freeze(provider_id: &str) {
    let mut map = freeze_slot().lock().unwrap_or_else(|e| e.into_inner());
    map.insert(provider_id.to_string(), (Instant::now() + FREEZE, 0));
}

/// 一次普通失败：累计到阈值才冻结。
fn note_failure(provider_id: &str) {
    let mut map = freeze_slot().lock().unwrap_or_else(|e| e.into_inner());
    let entry = map
        .entry(provider_id.to_string())
        .or_insert((Instant::now(), 0));
    if entry.0 > Instant::now() {
        return;
    }
    entry.1 += 1;
    if entry.1 >= FAILURE_THRESHOLD {
        entry.0 = Instant::now() + FREEZE;
        entry.1 = 0;
    }
}

fn note_success(provider_id: &str) {
    freeze_slot()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(provider_id);
}

/// 按当前设置启动或停止路由服务，并把 `router` 供应商写进 providers.json。
pub fn apply(db: Arc<Database>) {
    tauri::async_runtime::spawn(async move {
        restart(db).await;
    });
}

async fn restart(db: Arc<Database>) {
    stop().await;
    let enabled = db.commandcode_route_enabled().unwrap_or(false);
    if !enabled {
        commandcode_config::sync_router_provider(None, &[]);
        return;
    }
    let slots = match db.list_commandcode_slots() {
        Ok(slots) => slots,
        Err(error) => {
            log::error!("[commandcode-route] 读取模型槽失败: {error}");
            return;
        }
    };
    match spawn_server(db).await {
        Ok(port) => {
            let pairs: Vec<(String, String)> = slots
                .iter()
                .map(|slot| (slot.id.clone(), slot.name.clone()))
                .collect();
            commandcode_config::sync_router_provider(Some(port), &pairs);
            log::info!(
                "[commandcode-route] 路由已在 127.0.0.1:{port} 启动，{} 个槽位",
                pairs.len()
            );
        }
        Err(error) => log::error!("[commandcode-route] 启动失败: {error}"),
    }
}

async fn stop() {
    let handle = handle_slot()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take();
    if let Some(handle) = handle {
        let _ = handle.shutdown.send(());
    }
}

pub(crate) async fn spawn_server(db: Arc<Database>) -> Result<u16, String> {
    let mut last_error = String::new();
    for offset in 0..10u16 {
        let port = PREFERRED_PORT + offset;
        let listener = match tokio::net::TcpListener::bind(("127.0.0.1", port)).await {
            Ok(listener) => listener,
            Err(error) => {
                last_error = format!("127.0.0.1:{port}: {error}");
                continue;
            }
        };
        let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
        let app = Router::new()
            .route("/v1/messages", post(handle_messages))
            .route("/healthz", axum::routing::get(|| async { "ok" }))
            .layer(DefaultBodyLimit::max(32 * 1024 * 1024))
            .with_state(Ctx { db });
        tokio::spawn(async move {
            let server = axum::serve(listener, app).with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            });
            if let Err(error) = server.await {
                log::error!("[commandcode-route] 服务退出: {error}");
            }
        });
        *handle_slot().lock().unwrap_or_else(|e| e.into_inner()) = Some(Handle {
            port,
            shutdown: shutdown_tx,
        });
        return Ok(port);
    }
    Err(last_error)
}

async fn handle_messages(
    State(ctx): State<Ctx>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    let Ok(mut payload) = serde_json::from_slice::<Value>(&body) else {
        return error_response(StatusCode::BAD_REQUEST, "请求体不是合法 JSON");
    };
    let Some(model) = payload
        .get("model")
        .and_then(Value::as_str)
        .map(str::to_string)
    else {
        return error_response(StatusCode::BAD_REQUEST, "请求缺少 model");
    };
    let Some(slot_id) = model.strip_prefix("router/") else {
        return error_response(
            StatusCode::BAD_REQUEST,
            &format!("模型 {model} 不是路由槽位，应形如 router/<槽位>"),
        );
    };
    let slots = match ctx.db.list_commandcode_slots() {
        Ok(slots) => slots,
        Err(error) => return error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string()),
    };
    let Some(slot) = slots.into_iter().find(|slot| slot.id == slot_id) else {
        return error_response(StatusCode::BAD_REQUEST, &format!("槽位 {slot_id} 不存在"));
    };
    if slot.entries.is_empty() {
        return error_response(
            StatusCode::BAD_REQUEST,
            &format!("槽位 {slot_id} 没有候选模型"),
        );
    }

    let mut last_error = String::from("没有可用候选");
    let mut attempts = 0usize;
    for entry in &slot.entries {
        if attempts >= MAX_ATTEMPTS {
            last_error.push_str("（已达最大尝试次数）");
            break;
        }
        if now_frozen(&entry.provider_id) {
            continue;
        }
        let Some(provider) = ctx
            .db
            .get_provider_by_id(&entry.provider_id, "commandcode")
            .ok()
            .flatten()
        else {
            last_error = format!("供应商 {} 不存在", entry.provider_id);
            continue;
        };
        let base_url = provider
            .settings_config
            .pointer("/options/baseURL")
            .or_else(|| provider.settings_config.pointer("/baseURL"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim_end_matches('/')
            .to_string();
        if base_url.is_empty() {
            last_error = format!("供应商 {} 没有 baseURL", provider.name);
            continue;
        }
        let api = provider
            .settings_config
            .get("api")
            .and_then(Value::as_str)
            .unwrap_or("anthropic-messages");
        if api != "anthropic-messages" {
            last_error = format!("供应商 {} 不是 anthropic-messages，跳过", provider.name);
            continue;
        }
        let Some(key) = lookup_key(&entry.provider_id, &provider.settings_config) else {
            freeze(&entry.provider_id);
            last_error = format!("供应商 {} 没有可用 key", provider.name);
            continue;
        };
        attempts += 1;
        let url = if base_url.ends_with("/v1") {
            format!("{base_url}/messages")
        } else {
            format!("{base_url}/v1/messages")
        };
        if let Some(object) = payload.as_object_mut() {
            object.insert("model".into(), json!(entry.model_id));
        }
        let client = match reqwest::Client::builder()
            .timeout(Duration::from_secs(600))
            .build()
        {
            Ok(client) => client,
            Err(error) => {
                return error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string())
            }
        };
        let mut request = client
            .post(&url)
            .header(header::CONTENT_TYPE, "application/json")
            .header("x-api-key", &key)
            .header(header::AUTHORIZATION, format!("Bearer {key}"))
            .json(&payload);
        for name in ["anthropic-version", "anthropic-beta"] {
            if let Some(value) = headers.get(name) {
                request = request.header(name, value);
            }
        }
        let sent = match tokio::time::timeout(FIRST_BYTE_TIMEOUT, request.send()).await {
            Ok(Ok(response)) => response,
            Ok(Err(error)) => {
                note_failure(&entry.provider_id);
                last_error = format!("{}: {error}", provider.name);
                continue;
            }
            Err(_) => {
                note_failure(&entry.provider_id);
                last_error = format!("{}: 首字节超时", provider.name);
                continue;
            }
        };
        let status = sent.status();
        let content_type = sent.headers().get(header::CONTENT_TYPE).cloned();
        if status.is_success() {
            note_success(&entry.provider_id);
            let mut response = Response::new(Body::from_stream(sent.bytes_stream()));
            *response.status_mut() = status;
            if let Some(content_type) = content_type {
                response
                    .headers_mut()
                    .insert(header::CONTENT_TYPE, content_type);
            }
            return response;
        }
        let text = sent.text().await.unwrap_or_default();
        let snippet: String = text.chars().take(300).collect();
        match status.as_u16() {
            401 | 403 => {
                freeze(&entry.provider_id);
                last_error = format!("{}: 凭据被拒 ({})", provider.name, status);
            }
            429 | 500..=599 | 404 => {
                note_failure(&entry.provider_id);
                last_error = format!("{}: {} {}", provider.name, status, snippet);
            }
            _ => {
                // 其它 4xx 是请求本身的问题，换一家也不会变，直接回给客户端。
                let mut response = Response::new(Body::from(text));
                *response.status_mut() = status;
                if let Some(content_type) = content_type {
                    response
                        .headers_mut()
                        .insert(header::CONTENT_TYPE, content_type);
                }
                return response;
            }
        }
    }
    error_response(
        StatusCode::BAD_GATEWAY,
        &format!("槽位 {slot_id} 的所有候选都失败了：{last_error}"),
    )
}

fn error_response(status: StatusCode, message: &str) -> Response {
    let body = json!({ "type": "error", "error": { "type": "api_error", "message": message } });
    let mut response = Response::new(Body::from(body.to_string()));
    *response.status_mut() = status;
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    response
}

/// 供应商 key：优先读 Command Code 的 auth 文件（本地模式读 auth.local.json），
/// 其次用供应商配置里写死的字面量。
fn lookup_key(provider_id: &str, settings: &Value) -> Option<String> {
    let dir = crate::commandcode_config::data_dir();
    for name in ["auth.local.json", "auth.json"] {
        let Ok(text) = std::fs::read_to_string(dir.join(name)) else {
            continue;
        };
        let Ok(Value::Object(document)) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        if let Some(key) = document
            .get(provider_id)
            .and_then(|entry| entry.get("key"))
            .and_then(Value::as_str)
            .filter(|key| !key.is_empty())
        {
            return Some(key.to_string());
        }
    }
    settings
        .pointer("/options/apiKey")
        .and_then(Value::as_str)
        .filter(|key| {
            !key.is_empty()
                && !key.starts_with('$')
                && !key.starts_with('!')
                && !key.contains("{env:")
        })
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider::Provider;
    use axum::routing::post;

    fn provider(id: &str, base_url: &str, api_key: &str) -> Provider {
        Provider::with_id(
            id.into(),
            id.into(),
            serde_json::json!({
                "api": "anthropic-messages",
                "options": { "baseURL": base_url, "apiKey": api_key },
                "models": { "m1": { "name": "M1" } }
            }),
            None,
        )
    }

    #[tokio::test]
    #[serial_test::serial]
    async fn fails_over_to_the_next_candidate_before_first_byte() {
        let home = tempfile::tempdir().unwrap();
        std::env::set_var("CC_SWITCH_TEST_HOME", home.path());
        let db = Arc::new(Database::init().unwrap());

        // 第一家：一直 500，应当被跳过。
        let bad = axum::Router::new().route(
            "/v1/messages",
            post(|| async { (StatusCode::INTERNAL_SERVER_ERROR, "boom") }),
        );
        let bad_listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let bad_url = format!("http://{}", bad_listener.local_addr().unwrap());
        tokio::spawn(async move {
            axum::serve(bad_listener, bad).await.unwrap();
        });

        // 第二家：200 + 回显收到的 model，顺便验证代理改写了模型名。
        let good = axum::Router::new().route(
            "/v1/messages",
            post(|body: axum::body::Bytes| async move {
                let model = serde_json::from_slice::<Value>(&body)
                    .ok()
                    .and_then(|v| v.get("model").and_then(Value::as_str).map(str::to_string))
                    .unwrap_or_default();
                let mut response = Response::new(Body::from(format!("ok:{model}")));
                response.headers_mut().insert(
                    header::CONTENT_TYPE,
                    HeaderValue::from_static("text/event-stream"),
                );
                response
            }),
        );
        let good_listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let good_url = format!("http://{}", good_listener.local_addr().unwrap());
        tokio::spawn(async move {
            axum::serve(good_listener, good).await.unwrap();
        });

        db.save_provider("commandcode", &provider("bad", &bad_url, "k-bad"))
            .unwrap();
        db.save_provider("commandcode", &provider("good", &good_url, "k-good"))
            .unwrap();
        db.save_commandcode_slot(&crate::database::dao::commandcode_route::ModelSlot {
            id: "s1".into(),
            name: "槽位一".into(),
            entries: vec![
                crate::database::dao::commandcode_route::SlotEntry {
                    provider_id: "bad".into(),
                    model_id: "m1".into(),
                },
                crate::database::dao::commandcode_route::SlotEntry {
                    provider_id: "good".into(),
                    model_id: "m1".into(),
                },
            ],
        })
        .unwrap();

        let port = spawn_server(db.clone()).await.unwrap();
        let client = reqwest::Client::new();
        let response = client
            .post(format!("http://127.0.0.1:{port}/v1/messages"))
            .json(&serde_json::json!({ "model": "router/s1", "messages": [] }))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.text().await.unwrap(), "ok:m1");

        stop().await;
        std::env::remove_var("CC_SWITCH_TEST_HOME");
    }
}
