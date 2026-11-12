use crate::app_config::{AppType, McpApps, McpServer};
use crate::error::AppError;
use crate::store::AppState;
use serde_json::{json, Value};

pub(crate) fn sync(id: &str, spec: Option<&Value>) -> Result<(), AppError> {
    sync_and_commit(id, spec, || Ok(()))
}

pub(crate) fn sync_and_commit<T>(
    id: &str,
    spec: Option<&Value>,
    commit: impl FnOnce() -> Result<T, AppError>,
) -> Result<T, AppError> {
    crate::commandcode_config::sync_mcp_and_commit(id, spec, commit)
}

/// Reads `~/.commandcode/mcp.json` and registers servers CC Switch does not know yet.
pub(crate) fn import(state: &AppState) -> Result<usize, AppError> {
    let mut existing = state.db.get_all_mcp_servers()?;
    let mut count = 0;
    for (id, entry) in crate::commandcode_config::mcp_entries()? {
        let mut spec = entry;
        if let Some(object) = spec.as_object_mut() {
            // Command Code infers the transport the same way; spell it out for the editor.
            if !object.contains_key("type") {
                let transport = if object.contains_key("url") {
                    "http"
                } else {
                    "stdio"
                };
                object.insert("type".into(), json!(transport));
            }
        }
        if super::validation::validate_server_spec(&spec).is_err() {
            continue;
        }
        if let Some(server) = existing.shift_remove(&id) {
            // Never adopt a different definition or steal another app's toggle.
            let fields = ["type", "command", "args", "env", "cwd", "url", "headers"];
            if fields
                .iter()
                .any(|field| server.server.get(*field) != spec.get(*field))
            {
                continue;
            }
            if !server.apps.commandcode {
                let mut server = server;
                server.apps.set_enabled_for(&AppType::Commandcode, true);
                state.db.save_mcp_server(&server)?;
            }
            continue;
        }
        count += 1;
        let mut apps = McpApps::default();
        apps.set_enabled_for(&AppType::Commandcode, true);
        let server = McpServer {
            id: id.clone(),
            name: id,
            server: spec,
            apps,
            description: None,
            homepage: None,
            docs: None,
            tags: vec![],
        };
        state.db.save_mcp_server(&server)?;
    }
    Ok(count)
}
