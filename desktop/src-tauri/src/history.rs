use std::{fs, path::PathBuf};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentHistorySession {
    pub document: Value,
    pub entities: Vec<Value>,
    pub anonymized_text: String,
    pub replacement_map: Value,
    #[serde(default)]
    pub offset_map: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentHistoryEntry {
    pub id: i64,
    pub created_at: String,
    pub session: DocumentHistorySession,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentHistorySummary {
    pub id: i64,
    pub created_at: String,
    pub filename: String,
    pub document_format: String,
    pub document_source: String,
    pub entity_count: usize,
    pub accepted_entity_count: usize,
}

pub struct HistoryStore {
    db_path: PathBuf,
}

impl HistoryStore {
    pub fn new(db_path: impl Into<PathBuf>) -> Self {
        Self {
            db_path: db_path.into(),
        }
    }

    pub fn save(&self, session: &DocumentHistorySession) -> Result<DocumentHistoryEntry, String> {
        let connection = self.connection()?;
        let filename = document_string(&session.document, "filename", "dokument");
        let document_format = document_string(&session.document, "format", "txt");
        let document_source = document_string(&session.document, "source", "parsed");
        let entity_count = session.entities.len();
        let accepted_entity_count = session
            .entities
            .iter()
            .filter(|entity| entity_status(entity) != "rejected")
            .count();

        connection
            .execute(
                "INSERT INTO document_history (
                    filename,
                    document_format,
                    document_source,
                    entity_count,
                    accepted_entity_count,
                    document_json,
                    entities_json,
                    anonymized_text,
                    replacement_map_json,
                    offset_map_json
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    filename,
                    document_format,
                    document_source,
                    entity_count as i64,
                    accepted_entity_count as i64,
                    serde_json::to_string(&session.document).map_err(to_string_error)?,
                    serde_json::to_string(&session.entities).map_err(to_string_error)?,
                    &session.anonymized_text,
                    serde_json::to_string(&session.replacement_map).map_err(to_string_error)?,
                    serde_json::to_string(&session.offset_map).map_err(to_string_error)?,
                ],
            )
            .map_err(to_string_error)?;

        self.get(connection.last_insert_rowid())?
            .ok_or_else(|| "Nie udało się odczytać zapisanego wpisu historii.".to_string())
    }

    pub fn list(&self) -> Result<Vec<DocumentHistorySummary>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT
                    id,
                    created_at,
                    filename,
                    document_format,
                    document_source,
                    entity_count,
                    accepted_entity_count
                FROM document_history
                ORDER BY datetime(created_at) DESC, id DESC",
            )
            .map_err(to_string_error)?;
        let rows = statement
            .query_map([], |row| {
                Ok(DocumentHistorySummary {
                    id: row.get(0)?,
                    created_at: row.get(1)?,
                    filename: row.get(2)?,
                    document_format: row.get(3)?,
                    document_source: row.get(4)?,
                    entity_count: row.get::<_, i64>(5)? as usize,
                    accepted_entity_count: row.get::<_, i64>(6)? as usize,
                })
            })
            .map_err(to_string_error)?;

        rows.collect::<Result<Vec<_>, _>>().map_err(to_string_error)
    }

    pub fn get(&self, entry_id: i64) -> Result<Option<DocumentHistoryEntry>, String> {
        let connection = self.connection()?;
        connection
            .query_row(
                "SELECT id,
                    created_at,
                    document_json,
                    entities_json,
                    anonymized_text,
                    replacement_map_json,
                    offset_map_json
                FROM document_history
                WHERE id = ?1",
                params![entry_id],
                |row| {
                    let document_json: String = row.get(2)?;
                    let entities_json: String = row.get(3)?;
                    let replacement_map_json: String = row.get(5)?;
                    let offset_map_json: String = row.get(6)?;
                    Ok(DocumentHistoryEntry {
                        id: row.get(0)?,
                        created_at: row.get(1)?,
                        session: DocumentHistorySession {
                            document: serde_json::from_str(&document_json).map_err(to_sql_error)?,
                            entities: serde_json::from_str(&entities_json).map_err(to_sql_error)?,
                            anonymized_text: row.get(4)?,
                            replacement_map: serde_json::from_str(&replacement_map_json)
                                .map_err(to_sql_error)?,
                            offset_map: serde_json::from_str(&offset_map_json)
                                .map_err(to_sql_error)?,
                        },
                    })
                },
            )
            .optional()
            .map_err(to_string_error)
    }

    pub fn delete(&self, entry_id: i64) -> Result<(), String> {
        self.connection()?
            .execute(
                "DELETE FROM document_history WHERE id = ?1",
                params![entry_id],
            )
            .map(|_| ())
            .map_err(to_string_error)
    }

    pub fn clear(&self) -> Result<(), String> {
        self.connection()?
            .execute("DELETE FROM document_history", [])
            .map(|_| ())
            .map_err(to_string_error)
    }

    fn connection(&self) -> Result<Connection, String> {
        if let Some(parent) = self.db_path.parent() {
            fs::create_dir_all(parent).map_err(to_string_error)?;
        }
        let connection = Connection::open(&self.db_path).map_err(to_string_error)?;
        connection
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS document_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                    filename TEXT NOT NULL,
                    document_format TEXT NOT NULL,
                    document_source TEXT NOT NULL,
                    entity_count INTEGER NOT NULL,
                    accepted_entity_count INTEGER NOT NULL,
                    document_json TEXT NOT NULL,
                    entities_json TEXT NOT NULL,
                    anonymized_text TEXT NOT NULL,
                    replacement_map_json TEXT NOT NULL,
                    offset_map_json TEXT NOT NULL DEFAULT '[]'
                );
                CREATE INDEX IF NOT EXISTS idx_document_history_created_at
                    ON document_history(created_at DESC);",
            )
            .map_err(to_string_error)?;
        ensure_offset_map_column(&connection)?;
        Ok(connection)
    }
}

fn ensure_offset_map_column(connection: &Connection) -> Result<(), String> {
    let mut statement = connection
        .prepare("PRAGMA table_info(document_history)")
        .map_err(to_string_error)?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(to_string_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(to_string_error)?;
    if !columns.iter().any(|column| column == "offset_map_json") {
        connection
            .execute(
                "ALTER TABLE document_history
                    ADD COLUMN offset_map_json TEXT NOT NULL DEFAULT '[]'",
                [],
            )
            .map_err(to_string_error)?;
    }
    Ok(())
}

#[tauri::command]
pub fn save_document_history_entry(
    app: AppHandle,
    session: DocumentHistorySession,
) -> Result<DocumentHistoryEntry, String> {
    history_store(&app)?.save(&session)
}

#[tauri::command]
pub fn list_document_history(app: AppHandle) -> Result<Vec<DocumentHistorySummary>, String> {
    history_store(&app)?.list()
}

#[tauri::command]
pub fn get_document_history_entry(
    app: AppHandle,
    entry_id: i64,
) -> Result<Option<DocumentHistoryEntry>, String> {
    history_store(&app)?.get(entry_id)
}

#[tauri::command]
pub fn delete_document_history_entry(app: AppHandle, entry_id: i64) -> Result<(), String> {
    history_store(&app)?.delete(entry_id)
}

#[tauri::command]
pub fn clear_document_history(app: AppHandle) -> Result<(), String> {
    history_store(&app)?.clear()
}

fn history_store(app: &AppHandle) -> Result<HistoryStore, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Nie można odczytać katalogu danych aplikacji: {error}"))?;
    Ok(HistoryStore::new(
        app_data_dir.join("document-history.sqlite3"),
    ))
}

fn document_string(document: &Value, key: &str, fallback: &str) -> String {
    document
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn entity_status(entity: &Value) -> String {
    entity
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("accepted")
        .to_ascii_lowercase()
}

fn to_string_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn to_sql_error(error: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_document_history_session() {
        let store = test_store("round_trip");
        let session = sample_session();

        let saved = store.save(&session).expect("save history");
        let loaded = store
            .get(saved.id)
            .expect("load history")
            .expect("history entry exists");

        assert_eq!(loaded.session, session);
        assert_eq!(
            store.list().expect("list history")[0].accepted_entity_count,
            1
        );
        cleanup_store(&store);
    }

    #[test]
    fn deletes_single_entry_and_clears_all_entries() {
        let store = test_store("delete_clear");
        let first = store.save(&sample_session()).expect("save first");
        let second = store.save(&sample_session()).expect("save second");

        store.delete(first.id).expect("delete first");

        assert!(store.get(first.id).expect("load deleted").is_none());
        assert!(store.get(second.id).expect("load second").is_some());

        store.clear().expect("clear history");

        assert!(store.list().expect("list cleared").is_empty());
        cleanup_store(&store);
    }

    fn sample_session() -> DocumentHistorySession {
        DocumentHistorySession {
            document: serde_json::json!({
                "filename": "umowa.txt",
                "format": "txt",
                "source": "parsed",
                "page_count": 1,
                "text": "Jan Kowalski ma PESEL 44051401359."
            }),
            entities: vec![
                serde_json::json!({
                    "id": "entity-1",
                    "category": "PERSON",
                    "start": 0,
                    "end": 12,
                    "text": "Jan Kowalski",
                    "confidence": 0.9,
                    "source": "ner",
                    "validation": "not_applicable",
                    "status": "accepted",
                    "entity_group_id": "person-1",
                    "canonical_text": "Jan Kowalski"
                }),
                serde_json::json!({
                    "id": "entity-2",
                    "category": "PESEL",
                    "start": 22,
                    "end": 33,
                    "text": "44051401359",
                    "confidence": 1,
                    "source": "regex",
                    "validation": "passed",
                    "status": "rejected",
                    "entity_group_id": "pesel-1",
                    "canonical_text": "44051401359"
                }),
            ],
            anonymized_text: "[OSOBA_1] ma PESEL 44051401359.".to_string(),
            replacement_map: serde_json::json!({
                "entries": [
                    {
                        "token": "[OSOBA_1]",
                        "category": "PERSON",
                        "canonical_text": "Jan Kowalski",
                        "variants": ["Jan Kowalski"]
                    }
                ],
                "document_fingerprint": "abc"
            }),
            offset_map: vec![serde_json::json!({
                "original_start": 0,
                "original_end": 12,
                "anonymized_start": 0,
                "anonymized_end": 9,
                "token": "[OSOBA_1]",
                "category": "PERSON"
            })],
        }
    }

    fn test_store(name: &str) -> HistoryStore {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let db_path = std::env::temp_dir().join(format!(
            "anonymizer-history-{name}-{}-{unique}.sqlite3",
            std::process::id(),
        ));
        let _ = std::fs::remove_file(&db_path);
        HistoryStore::new(db_path)
    }

    fn cleanup_store(store: &HistoryStore) {
        let _ = std::fs::remove_file(&store.db_path);
    }
}
