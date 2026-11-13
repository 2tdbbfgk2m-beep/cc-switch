//! Command Code 模型槽：槽位 -> 有序候选（provider + model）。
use crate::database::{lock_conn, Database};
use crate::error::AppError;
use rusqlite::params;
use serde::{Deserialize, Serialize};

pub const ROUTE_MODE_KEY: &str = "commandcode_route_mode";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SlotEntry {
    pub provider_id: String,
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelSlot {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub entries: Vec<SlotEntry>,
}

impl Database {
    pub fn list_commandcode_slots(&self) -> Result<Vec<ModelSlot>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare("SELECT id, name FROM commandcode_slots ORDER BY sort_index ASC, name ASC")
            .map_err(|e| AppError::Database(e.to_string()))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| AppError::Database(e.to_string()))?;
        let mut slots = Vec::new();
        for row in rows {
            let (id, name) = row.map_err(|e| AppError::Database(e.to_string()))?;
            let mut entries_stmt = conn
                .prepare(
                    "SELECT provider_id, model_id FROM commandcode_slot_entries
                     WHERE slot_id = ?1 ORDER BY priority ASC, rowid ASC",
                )
                .map_err(|e| AppError::Database(e.to_string()))?;
            let entries = entries_stmt
                .query_map(params![id], |row| {
                    Ok(SlotEntry {
                        provider_id: row.get(0)?,
                        model_id: row.get(1)?,
                    })
                })
                .map_err(|e| AppError::Database(e.to_string()))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| AppError::Database(e.to_string()))?;
            slots.push(ModelSlot { id, name, entries });
        }
        Ok(slots)
    }

    /// 覆盖式保存：槽位不存在就新建，候选整组替换。
    pub fn save_commandcode_slot(&self, slot: &ModelSlot) -> Result<(), AppError> {
        let mut conn = lock_conn!(self.conn);
        let tx = conn
            .transaction()
            .map_err(|e| AppError::Database(e.to_string()))?;
        let sort: i64 = tx
            .query_row(
                "SELECT COALESCE(MAX(sort_index), -1) + 1 FROM commandcode_slots WHERE id <> ?1",
                params![slot.id],
                |row| row.get(0),
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        tx.execute(
            "INSERT INTO commandcode_slots (id, name, sort_index, created_at)
             VALUES (?1, ?2, ?3, strftime('%s','now'))
             ON CONFLICT(id) DO UPDATE SET name = excluded.name",
            params![slot.id, slot.name, sort],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        tx.execute(
            "DELETE FROM commandcode_slot_entries WHERE slot_id = ?1",
            params![slot.id],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        for (index, entry) in slot.entries.iter().enumerate() {
            tx.execute(
                "INSERT OR REPLACE INTO commandcode_slot_entries
                 (slot_id, provider_id, model_id, priority) VALUES (?1, ?2, ?3, ?4)",
                params![slot.id, entry.provider_id, entry.model_id, index as i64],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        }
        tx.commit().map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn delete_commandcode_slot(&self, id: &str) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "DELETE FROM commandcode_slot_entries WHERE slot_id = ?1",
            params![id],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        conn.execute("DELETE FROM commandcode_slots WHERE id = ?1", params![id])
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn commandcode_route_enabled(&self) -> Result<bool, AppError> {
        Ok(self
            .get_setting(ROUTE_MODE_KEY)?
            .is_some_and(|value| value == "1"))
    }

    pub fn set_commandcode_route_enabled(&self, enabled: bool) -> Result<(), AppError> {
        self.set_setting(ROUTE_MODE_KEY, if enabled { "1" } else { "0" })
    }
}
