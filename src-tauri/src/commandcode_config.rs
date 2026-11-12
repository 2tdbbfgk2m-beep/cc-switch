//! Command Code (`commandcode` / `cmd`) BYOK providers.
//!
//! Command Code reads custom providers from `~/.commandcode/providers.json`
//! (`{ "provider": { "<id>": { api, baseURL, headers, models } } }`). It refuses raw
//! secrets there: a literal key lives in `~/.commandcode/auth.json` under the provider id
//! as `{ "type": "api", "key": "..." }` (what `/connect` writes), while `$ENV`,
//! `{env:VAR}` and `!command` references stay in `providers.json`.
//!
//! Cards use the MCode shape (`{ name?, api, options: { baseURL, apiKey, headers? }, models }`).
//! Only the entry under the card id is touched; other providers, top-level keys and the
//! CLI's own login fields in `auth.json` are preserved.
use crate::config::{atomic_write_private, get_home_dir};
use crate::error::AppError;
use indexmap::IndexMap;
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

static LOCK: Mutex<()> = Mutex::new(());

/// Built-in subscription lanes plus `auth.json`'s own login fields.
const RESERVED_IDS: &[&str] = &[
    "anthropic",
    "github-copilot",
    "copilot",
    "codex",
    "openai",
    "command-code",
    "commandcode-gateway",
    "apiKey",
    "userId",
    "userName",
    "keyName",
    "authenticatedAt",
];

pub(crate) fn data_dir() -> PathBuf {
    get_home_dir().join(".commandcode")
}

pub(crate) fn config_path() -> PathBuf {
    data_dir().join("providers.json")
}

fn auth_path() -> PathBuf {
    data_dir().join("auth.json")
}

fn read_object(path: &Path) -> Result<Map<String, Value>, AppError> {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Map::new()),
        Err(e) => return Err(AppError::io(path, e)),
    };
    if text.trim().is_empty() {
        return Ok(Map::new());
    }
    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(map)) => Ok(map),
        _ => Err(AppError::Config(format!(
            "{} is not a JSON object; fix it before editing providers",
            path.display()
        ))),
    }
}

fn write_object(path: &Path, value: &Map<String, Value>) -> Result<(), AppError> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| AppError::io(dir, e))?;
    }
    let text = serde_json::to_string_pretty(value)
        .map_err(|e| AppError::Config(format!("Cannot serialize {}: {e}", path.display())))?;
    atomic_write_private(path, format!("{text}\n").as_bytes())
}

/// `provider` or `providers` (Command Code accepts both; `provider` wins).
fn map_key(document: &Map<String, Value>) -> &'static str {
    if document.get("provider").is_some_and(Value::is_object) {
        "provider"
    } else if document.get("providers").is_some_and(Value::is_object) {
        "providers"
    } else {
        "provider"
    }
}

fn is_key_reference(key: &str) -> bool {
    let env_name = |s: &str| {
        let mut chars = s.chars();
        chars
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
            && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
    };
    key.starts_with('!') || key.strip_prefix('$').is_some_and(env_name) || key.contains("{env:")
}

/// Native entry -> card: move `baseURL`/`apiKey`/`headers` into `options` and fill in a
/// stored key from `auth.json`.
fn to_card(entry: &Value, stored_key: Option<&str>) -> Value {
    let mut card = entry.as_object().cloned().unwrap_or_default();
    let mut options = match card.remove("options") {
        Some(Value::Object(options)) => options,
        _ => Map::new(),
    };
    for field in ["baseURL", "apiKey", "headers"] {
        if let Some(value) = card.remove(field) {
            options.entry(field).or_insert(value);
        }
    }
    if let Some(key) = stored_key {
        if !options
            .get("apiKey")
            .and_then(Value::as_str)
            .is_some_and(is_key_reference)
        {
            options.insert("apiKey".into(), Value::String(key.into()));
        }
    }
    card.insert("options".into(), Value::Object(options));
    Value::Object(card)
}

/// Card -> (native entry, literal key to store in `auth.json`).
fn to_native(card: &Value) -> (Value, Option<String>) {
    let mut entry = card.as_object().cloned().unwrap_or_default();
    entry.remove("kind");
    let mut options = match entry.remove("options") {
        Some(Value::Object(options)) => options,
        _ => Map::new(),
    };
    let key = options
        .remove("apiKey")
        .and_then(|v| v.as_str().map(str::trim).map(String::from))
        .filter(|k| !k.is_empty());
    if let Some(base_url) = options.remove("baseURL") {
        entry.insert("baseURL".into(), base_url);
    }
    if let Some(headers) = options.remove("headers") {
        if headers.as_object().is_some_and(|h| !h.is_empty()) {
            entry.insert("headers".into(), headers);
        }
    }
    if !options.is_empty() {
        entry.insert("options".into(), Value::Object(options));
    }
    match key {
        Some(key) if is_key_reference(&key) => {
            entry.insert("apiKey".into(), Value::String(key));
            (Value::Object(entry), None)
        }
        key => (Value::Object(entry), key),
    }
}

fn stored_key(auth: &Map<String, Value>, id: &str) -> Option<String> {
    let entry = auth.get(id)?;
    (entry.get("type").and_then(Value::as_str) == Some("api"))
        .then(|| entry.get("key").and_then(Value::as_str).map(String::from))
        .flatten()
}

pub(crate) fn get_providers() -> Result<IndexMap<String, Value>, AppError> {
    let document = read_object(&config_path())?;
    let auth = read_object(&auth_path()).unwrap_or_default();
    let Some(Value::Object(providers)) = document.get(map_key(&document)) else {
        return Ok(IndexMap::new());
    };
    Ok(providers
        .iter()
        .filter(|(_, entry)| entry.is_object())
        .map(|(id, entry)| (id.clone(), to_card(entry, stored_key(&auth, id).as_deref())))
        .collect())
}

pub(crate) fn provider_key_exists(id: &str) -> Result<bool, AppError> {
    let document = read_object(&config_path())?;
    Ok(document
        .get(map_key(&document))
        .and_then(Value::as_object)
        .is_some_and(|providers| providers.contains_key(id)))
}

pub(crate) fn validate_provider(id: &str, config: &Value) -> Result<(), AppError> {
    let valid_id = {
        let mut chars = id.chars();
        chars
            .next()
            .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
            && id.len() <= 64
            && chars.all(|c| {
                c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '_' | '.' | '-')
            })
    };
    if !valid_id {
        return Err(AppError::InvalidInput(
            "Command Code provider id must start with a lowercase letter or digit and use only a-z, 0-9, '_', '.', '-' (max 64)".into(),
        ));
    }
    if RESERVED_IDS.contains(&id) {
        return Err(AppError::InvalidInput(format!(
            "'{id}' is reserved by Command Code; choose another provider id (e.g. '{id}-api')"
        )));
    }
    if !matches!(
        config
            .get("api")
            .map_or(Some("openai-completions"), Value::as_str),
        Some("anthropic-messages" | "openai-completions" | "openai-responses")
    ) {
        return Err(AppError::InvalidInput(
            "Select a supported Command Code API format".into(),
        ));
    }
    let base_url = config
        .pointer("/options/baseURL")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !url::Url::parse(base_url)
        .is_ok_and(|url| matches!(url.scheme(), "http" | "https") && url.host_str().is_some())
    {
        return Err(AppError::InvalidInput(
            "Enter a valid Command Code endpoint URL".into(),
        ));
    }
    if config
        .get("models")
        .and_then(Value::as_object)
        .is_none_or(|models| models.is_empty() || models.keys().any(|id| id.trim().is_empty()))
    {
        return Err(AppError::InvalidInput(
            "Add at least one Command Code model".into(),
        ));
    }
    Ok(())
}

/// Writes (or removes, with `None`) the card's entry, rolling `providers.json` back if
/// `auth.json` cannot be updated.
fn write_entry(id: &str, card: Option<&Value>, create_only: bool) -> Result<(), AppError> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let path = config_path();
    let mut document = read_object(&path)?;
    let key = map_key(&document);
    let providers = document
        .entry(key)
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .expect("map_key only picks objects or a fresh key");
    if create_only && providers.contains_key(id) {
        return Err(AppError::InvalidInput(format!(
            "Command Code provider '{id}' already exists"
        )));
    }
    let auth_file = auth_path();
    let mut auth = read_object(&auth_file)?;
    let before_auth = auth.clone();
    let literal_key = match card {
        Some(card) => {
            let (entry, literal) = to_native(card);
            providers.insert(id.into(), entry);
            literal
        }
        None => {
            providers.remove(id);
            None
        }
    };
    match literal_key {
        Some(key) => {
            auth.insert(id.into(), serde_json::json!({ "type": "api", "key": key }));
        }
        None => {
            // A reference or keyless card: drop a stale stored key so it cannot win over the
            // reference (Command Code prefers the stored key).
            if auth
                .get(id)
                .and_then(|e| e.get("type"))
                .and_then(Value::as_str)
                == Some("api")
            {
                auth.remove(id);
            }
        }
    }
    let previous = fs::read(&path).ok();
    write_object(&path, &document)?;
    if auth != before_auth {
        let auth_result = if auth.is_empty() {
            match fs::remove_file(&auth_file) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                    Err(AppError::io(&auth_file, e))
                }
                _ => Ok(()),
            }
        } else {
            write_object(&auth_file, &auth)
        };
        if let Err(error) = auth_result {
            let _ = match previous {
                Some(bytes) => atomic_write_private(&path, &bytes),
                None => fs::remove_file(&path).map_err(|e| AppError::io(&path, e)),
            };
            return Err(error);
        }
    }
    Ok(())
}

pub(crate) fn set_provider(id: &str, config: Value) -> Result<(), AppError> {
    validate_provider(id, &config)?;
    write_entry(id, Some(&config), false)
}

pub(crate) fn add_provider(id: &str, config: Value) -> Result<(), AppError> {
    validate_provider(id, &config)?;
    write_entry(id, Some(&config), true)
}

pub(crate) fn remove_provider(id: &str) -> Result<(), AppError> {
    if !config_path().exists() {
        return Ok(());
    }
    write_entry(id, None, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn card(key: &str) -> Value {
        json!({
            "name": "My LLM",
            "kind": "custom",
            "api": "openai-completions",
            "options": { "baseURL": "https://api.example.com/v1", "apiKey": key, "headers": { "X-A": "b" } },
            "models": { "m1": { "name": "M1", "limit": { "context": 128000, "output": 8192 } } }
        })
    }

    #[test]
    fn literal_key_goes_to_auth_and_round_trips() {
        let (entry, key) = to_native(&card("sk-123"));
        assert_eq!(key.as_deref(), Some("sk-123"));
        assert!(entry.get("apiKey").is_none());
        assert!(entry.get("kind").is_none());
        assert_eq!(entry["baseURL"], "https://api.example.com/v1");
        assert_eq!(entry["headers"]["X-A"], "b");
        let back = to_card(&entry, key.as_deref());
        assert_eq!(back["options"]["apiKey"], "sk-123");
        assert_eq!(back["options"]["baseURL"], "https://api.example.com/v1");
        assert_eq!(back["models"]["m1"]["limit"]["context"], 128000);
    }

    #[test]
    fn key_references_stay_in_providers_json() {
        for reference in [
            "$MY_KEY",
            "{env:MY_KEY}",
            "!security find-generic-password -w",
        ] {
            let (entry, key) = to_native(&card(reference));
            assert_eq!(key, None);
            assert_eq!(entry["apiKey"], reference);
        }
        let (_, key) = to_native(&card("$not valid"));
        assert_eq!(key.as_deref(), Some("$not valid"));
    }

    #[test]
    fn ids_are_validated_like_command_code() {
        let c = card("k");
        assert!(validate_provider("my-llm.v2_x", &c).is_ok());
        for bad in ["", "My", "-x", "a/b", "anthropic", "command-code", "apiKey"] {
            assert!(validate_provider(bad, &c).is_err(), "{bad}");
        }
        let mut no_models = c.clone();
        no_models["models"] = json!({});
        assert!(validate_provider("ok", &no_models).is_err());
    }

    #[test]
    #[serial_test::serial]
    fn write_preserves_foreign_entries_and_login_fields() {
        let home = tempfile::tempdir().unwrap();
        std::env::set_var("CC_SWITCH_TEST_HOME", home.path());
        let dir = home.path().join(".commandcode");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("providers.json"),
            r#"{"provider":{"other":{"baseURL":"https://o.example","models":{"x":{}}}},"extra":1}"#,
        )
        .unwrap();
        fs::write(
            dir.join("auth.json"),
            r#"{"apiKey":"user-login","userName":"me"}"#,
        )
        .unwrap();

        add_provider("mine", card("sk-1")).unwrap();
        assert!(add_provider("mine", card("sk-1")).is_err());
        let providers = get_providers().unwrap();
        assert_eq!(providers["mine"]["options"]["apiKey"], "sk-1");
        assert!(providers.contains_key("other"));
        let auth: Value =
            serde_json::from_slice(&fs::read(dir.join("auth.json")).unwrap()).unwrap();
        assert_eq!(auth["apiKey"], "user-login");
        assert_eq!(auth["mine"], json!({ "type": "api", "key": "sk-1" }));
        let doc: Value =
            serde_json::from_slice(&fs::read(dir.join("providers.json")).unwrap()).unwrap();
        assert_eq!(doc["extra"], 1);
        assert!(doc["provider"]["mine"].get("apiKey").is_none());

        set_provider("mine", card("$ENV_KEY")).unwrap();
        let auth: Value =
            serde_json::from_slice(&fs::read(dir.join("auth.json")).unwrap()).unwrap();
        assert!(auth.get("mine").is_none());

        remove_provider("mine").unwrap();
        assert!(!provider_key_exists("mine").unwrap());
        assert!(provider_key_exists("other").unwrap());
        std::env::remove_var("CC_SWITCH_TEST_HOME");
    }
}
