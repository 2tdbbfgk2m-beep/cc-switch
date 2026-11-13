//! Command Code 模型槽（本地路由）的命令。
use crate::app_config::AppType;
use crate::database::dao::commandcode_route::ModelSlot;
use crate::store::AppState;
use serde::Serialize;
use serde_json::Value;
use tauri::State;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteModel {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteProvider {
    pub id: String,
    pub name: String,
    pub models: Vec<RouteModel>,
}

#[tauri::command]
pub async fn get_commandcode_route_mode(state: State<'_, AppState>) -> Result<bool, String> {
    state
        .db
        .commandcode_route_enabled()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_commandcode_route_mode(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<bool, String> {
    state
        .db
        .set_commandcode_route_enabled(enabled)
        .map_err(|e| e.to_string())?;
    crate::commandcode_route::apply(state.db.clone());
    Ok(enabled)
}

/// 可作为槽位候选的供应商与模型：只列 anthropic-messages 的 Command Code 供应商。
#[tauri::command]
pub async fn list_commandcode_route_options(
    state: State<'_, AppState>,
) -> Result<Vec<RouteProvider>, String> {
    let providers = state
        .db
        .get_all_providers(AppType::Commandcode.as_str())
        .map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for provider in providers.values() {
        let api = provider
            .settings_config
            .get("api")
            .and_then(Value::as_str)
            .unwrap_or("anthropic-messages");
        if api != "anthropic-messages" {
            continue;
        }
        let models = provider
            .settings_config
            .get("models")
            .and_then(Value::as_object)
            .map(|models| {
                models
                    .iter()
                    .map(|(id, spec)| RouteModel {
                        id: id.clone(),
                        name: spec
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or(id)
                            .to_string(),
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        result.push(RouteProvider {
            id: provider.id.clone(),
            name: provider.name.clone(),
            models,
        });
    }
    Ok(result)
}

#[tauri::command]
pub async fn list_commandcode_slots(state: State<'_, AppState>) -> Result<Vec<ModelSlot>, String> {
    state.db.list_commandcode_slots().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_commandcode_slot(
    state: State<'_, AppState>,
    slot: ModelSlot,
) -> Result<Vec<ModelSlot>, String> {
    let id = slot.id.trim();
    if id.is_empty() || id.len() > 64 || id.contains('/') {
        return Err("槽位标识不能为空、不能包含 '/'，最长 64 个字符".into());
    }
    if slot.name.trim().is_empty() {
        return Err("槽位名称不能为空".into());
    }
    for entry in &slot.entries {
        let provider = state
            .db
            .get_provider_by_id(&entry.provider_id, AppType::Commandcode.as_str())
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("供应商 {} 不存在", entry.provider_id))?;
        let api = provider
            .settings_config
            .get("api")
            .and_then(Value::as_str)
            .unwrap_or("anthropic-messages");
        if api != "anthropic-messages" {
            return Err(format!(
                "供应商 {} 不是 anthropic-messages，不能用于路由",
                provider.name
            ));
        }
        let has_model = provider
            .settings_config
            .get("models")
            .and_then(Value::as_object)
            .is_some_and(|models| models.contains_key(&entry.model_id));
        if !has_model {
            return Err(format!(
                "供应商 {} 没有模型 {}",
                provider.name, entry.model_id
            ));
        }
    }
    state
        .db
        .save_commandcode_slot(&slot)
        .map_err(|e| e.to_string())?;
    let slots = state
        .db
        .list_commandcode_slots()
        .map_err(|e| e.to_string())?;
    crate::commandcode_route::apply(state.db.clone());
    Ok(slots)
}

#[tauri::command]
pub async fn delete_commandcode_slot(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<ModelSlot>, String> {
    state
        .db
        .delete_commandcode_slot(&id)
        .map_err(|e| e.to_string())?;
    let slots = state
        .db
        .list_commandcode_slots()
        .map_err(|e| e.to_string())?;
    crate::commandcode_route::apply(state.db.clone());
    Ok(slots)
}
