use keyring::Entry;
use uuid::Uuid;

const SERVICE: &str = "AlternateHistoryDemo";

fn entry_for(provider_id: Uuid) -> keyring::Result<Entry> {
    Entry::new(SERVICE, &provider_id.to_string())
}

pub fn set_api_key(provider_id: Uuid, api_key: &str) -> keyring::Result<()> {
    let entry = entry_for(provider_id)?;
    entry.set_password(api_key)
}

pub fn get_api_key(provider_id: Uuid) -> keyring::Result<Option<String>> {
    let entry = entry_for(provider_id)?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn delete_api_key(provider_id: Uuid) -> keyring::Result<()> {
    let entry = entry_for(provider_id)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // This test actually touches the OS keyring. Gated so CI can opt out.
    #[test]
    #[ignore = "touches OS keyring; run with `cargo test -- --ignored`"]
    fn set_get_delete_round_trip() {
        let id = Uuid::new_v4();
        set_api_key(id, "test-secret-12345").expect("set");
        let got = get_api_key(id).expect("get");
        assert_eq!(got.as_deref(), Some("test-secret-12345"));
        delete_api_key(id).expect("delete");
        let after = get_api_key(id).expect("get-after-delete");
        assert!(after.is_none());
    }
}
