use rusqlite::Connection;
use std::path::{Path, PathBuf};
use uuid::Uuid;

use crate::error::{AppError, Result};

const APP_DIR: &str = "AlternateHistoryDemo";
const SAVES_SUBDIR: &str = "saves";

/// Returns the directory that holds save DBs.
pub fn saves_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(APP_DIR)
        .join(SAVES_SUBDIR)
}

/// Returns the path to a specific save's SQLite file.
pub fn save_db_path(save_id: Uuid) -> PathBuf {
    saves_dir().join(format!("{}.sqlite", save_id))
}

/// Open (or create) a SQLite connection for a given save id.
/// Caller is responsible for running migrations afterward.
pub fn open_save_db(save_id: Uuid) -> Result<Connection> {
    let dir = saves_dir();
    std::fs::create_dir_all(&dir)?;
    let path = save_db_path(save_id);
    open_db_at(&path)
}

pub fn open_db_at(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path).map_err(rusqlite_err)?;
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")
        .map_err(rusqlite_err)?;
    Ok(conn)
}

pub(crate) fn rusqlite_err(e: rusqlite::Error) -> AppError {
    AppError::Db(e.to_string())
}

#[cfg(test)]
pub fn open_in_memory() -> Result<Connection> {
    let conn = Connection::open_in_memory().map_err(rusqlite_err)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(rusqlite_err)?;
    Ok(conn)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_in_memory_succeeds() {
        let _conn = open_in_memory().expect("open in-memory");
    }

    #[test]
    fn save_db_path_includes_save_id() {
        let id = Uuid::new_v4();
        let p = save_db_path(id);
        assert!(p.to_string_lossy().contains(&id.to_string()));
        assert!(p.to_string_lossy().ends_with(".sqlite"));
    }
}
