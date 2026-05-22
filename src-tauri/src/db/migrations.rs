use rusqlite::{params, Connection};

use crate::error::Result;

use super::connection::rusqlite_err;

const M_001_INITIAL: &str = include_str!("./migrations/m_001_initial.sql");

const MIGRATIONS: &[(i64, &str)] = &[(1, M_001_INITIAL)];

pub fn apply_pending(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )
    .map_err(rusqlite_err)?;

    let mut applied: Vec<i64> = {
        let mut stmt = conn
            .prepare("SELECT version FROM _migrations ORDER BY version ASC")
            .map_err(rusqlite_err)?;
        let rows = stmt
            .query_map([], |row| row.get::<_, i64>(0))
            .map_err(rusqlite_err)?;
        rows.filter_map(|r| r.ok()).collect()
    };
    applied.sort();

    for (version, sql) in MIGRATIONS {
        if applied.binary_search(version).is_ok() {
            continue;
        }
        let tx = conn.unchecked_transaction().map_err(rusqlite_err)?;
        tx.execute_batch(sql).map_err(rusqlite_err)?;
        tx.execute(
            "INSERT INTO _migrations (version) VALUES (?1)",
            params![version],
        )
        .map_err(rusqlite_err)?;
        tx.commit().map_err(rusqlite_err)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connection::open_in_memory;

    #[test]
    fn apply_pending_creates_all_tables() {
        let conn = open_in_memory().unwrap();
        apply_pending(&conn).expect("apply");

        for table in ["saves", "branches", "snapshots", "events", "_migrations"] {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?1",
                    params![table],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "missing table: {}", table);
        }
    }

    #[test]
    fn apply_pending_is_idempotent() {
        let conn = open_in_memory().unwrap();
        apply_pending(&conn).expect("first apply");
        apply_pending(&conn).expect("second apply (should be a no-op)");
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM _migrations", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }
}
