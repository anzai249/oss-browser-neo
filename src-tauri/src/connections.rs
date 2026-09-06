use crate::oss::Credentials;
use serde::{Deserialize, Serialize};
use std::{io::Write, path::PathBuf, sync::Mutex};
use tauri::Manager;

const SERVICE: &str = "top.sleepingbed.oss-browser-neo";
const LEGACY: &str = "saved-connection-v1";
const INDEX: &str = "catalog";
static STORE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Serialize, Deserialize)]
struct Entry {
    id: String,
    key: String,
}
#[derive(Serialize, Deserialize)]
struct Catalog {
    version: u8,
    entries: Vec<Entry>,
    #[serde(default)]
    pending_delete: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedConnection {
    pub id: String,
    name: String,
    region: String,
    bucket: String,
    access_key_id: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogView {
    profiles: Vec<SavedConnection>,
    cleanup_pending: bool,
    missing_removed: bool,
}
fn public_profile(id: String, c: Credentials) -> SavedConnection {
    SavedConnection {
        id,
        name: c.name,
        region: c.region,
        bucket: c.bucket,
        access_key_id: c.access_key_id,
    }
}
trait Store {
    fn read(&self, key: &str) -> Result<Option<String>, String>;
    fn write(&self, key: &str, value: &str) -> Result<(), String>;
    fn remove(&self, key: &str) -> Result<(), String>;
}
struct SystemStore {
    path: PathBuf,
}
impl SystemStore {
    fn credential_path(&self, key: &str) -> Result<PathBuf, String> {
        if !valid_key(key) {
            return Err("errors.persistenceCorrupt".into());
        }
        Ok(self
            .path
            .parent()
            .ok_or_else(|| "errors.persistenceUnavailable".to_string())?
            .join("credentials-v2")
            .join(format!("{key}.json")))
    }
}

fn atomic_write(path: &std::path::Path, value: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "errors.persistenceUnavailable".to_string())?;
    std::fs::create_dir_all(parent).map_err(|_| "errors.persistenceWrite".to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))
            .map_err(|_| "errors.persistenceWrite".to_string())?;
    }
    let mut file = tempfile::NamedTempFile::new_in(parent)
        .map_err(|_| "errors.persistenceWrite".to_string())?;
    file.write_all(value.as_bytes())
        .map_err(|_| "errors.persistenceWrite".to_string())?;
    file.as_file()
        .sync_all()
        .map_err(|_| "errors.persistenceWrite".to_string())?;
    file.persist(path)
        .map_err(|_| "errors.persistenceWrite".to_string())?;
    Ok(())
}
fn keyring_entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, key).map_err(|_| "errors.persistenceUnavailable".into())
}
impl Store for SystemStore {
    fn read(&self, key: &str) -> Result<Option<String>, String> {
        if key == INDEX {
            return match std::fs::read_to_string(&self.path) {
                Ok(value) => Ok(Some(value)),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
                Err(_) => Err("errors.persistenceRead".into()),
            };
        }
        let keyring_result = match keyring_entry(key)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("errors.persistenceRead".into()),
        };
        if keyring_result.as_ref().is_ok_and(Option::is_some) {
            return keyring_result;
        }
        match std::fs::read_to_string(self.credential_path(key)?) {
            Ok(value) => Ok(Some(value)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => keyring_result,
            Err(_) => Err("errors.persistenceRead".into()),
        }
    }
    fn write(&self, key: &str, value: &str) -> Result<(), String> {
        if key == INDEX {
            return atomic_write(&self.path, value);
        }
        atomic_write(&self.credential_path(key)?, value)?;
        // Local unsigned development builds can lose access to Keychain items
        // after their binary is replaced. The owner-only file is the durable
        // source; Keychain remains a best-effort system copy.
        let _ = keyring_entry(key).and_then(|entry| {
            entry
                .set_password(value)
                .map_err(|_| "errors.persistenceWrite".into())
        });
        Ok(())
    }
    fn remove(&self, key: &str) -> Result<(), String> {
        let path = self.credential_path(key)?;
        match std::fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("errors.persistenceRemove".into()),
        }
        let _ = keyring_entry(key).and_then(|entry| match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err("errors.persistenceRemove".into()),
        });
        Ok(())
    }
}
fn valid_key(key: &str) -> bool {
    key == LEGACY
        || key
            .strip_prefix("connection-v2-")
            .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok())
}
fn write_catalog(store: &impl Store, catalog: &Catalog) -> Result<(), String> {
    store.write(
        INDEX,
        &serde_json::to_string(catalog).map_err(|_| "errors.persistenceWrite".to_string())?,
    )
}
fn read_credentials(store: &impl Store, key: &str) -> Result<Credentials, String> {
    let value = store
        .read(key)?
        .ok_or_else(|| "errors.savedConnectionMissing".to_string())?;
    serde_json::from_str(&value).map_err(|_| "errors.persistenceCorrupt".into())
}
// The index contains only opaque IDs, never connection details or secrets. Each
// revision is a separate credential, so a failed save leaves the old entry intact.
fn cleanup(store: &impl Store, catalog: &mut Catalog) {
    if catalog.pending_delete.is_empty() {
        return;
    }
    let remaining: Vec<_> = catalog
        .pending_delete
        .iter()
        .filter(|key| store.remove(key).is_err())
        .cloned()
        .collect();
    let previous = std::mem::replace(&mut catalog.pending_delete, remaining);
    if write_catalog(store, catalog).is_err() {
        catalog.pending_delete = previous;
    }
}
fn catalog(store: &impl Store) -> Result<Catalog, String> {
    let mut result = match store.read(INDEX)? {
        Some(value) => serde_json::from_str::<Catalog>(&value)
            .map_err(|_| "errors.persistenceCorrupt".to_string())?,
        None => {
            let mut initial = Catalog {
                version: 2,
                entries: vec![],
                pending_delete: vec![],
            };
            if store.read(LEGACY)?.is_some() {
                read_credentials(store, LEGACY)?;
                initial.entries.push(Entry {
                    id: uuid::Uuid::new_v4().to_string(),
                    key: LEGACY.into(),
                });
            }
            write_catalog(store, &initial)?;
            initial
        }
    };
    let mut ids = std::collections::HashSet::new();
    let mut keys = std::collections::HashSet::new();
    if result.version != 2
        || result.entries.iter().any(|e| {
            uuid::Uuid::parse_str(&e.id).is_err()
                || !valid_key(&e.key)
                || !ids.insert(&e.id)
                || !keys.insert(&e.key)
        })
        || result
            .pending_delete
            .iter()
            .any(|key| !valid_key(key) || keys.contains(key))
    {
        return Err("errors.persistenceCorrupt".into());
    }
    cleanup(store, &mut result);
    Ok(result)
}
fn view(store: &impl Store, catalog: &mut Catalog) -> Result<CatalogView, String> {
    let mut profiles = Vec::new();
    let mut missing = std::collections::HashSet::new();
    for entry in &catalog.entries {
        match read_credentials(store, &entry.key) {
            Ok(credentials) => profiles.push(public_profile(entry.id.clone(), credentials)),
            Err(error) if error == "errors.savedConnectionMissing" => {
                missing.insert(entry.key.clone());
            }
            Err(error) => return Err(error),
        }
    }
    let missing_removed = !missing.is_empty();
    if missing_removed {
        catalog
            .entries
            .retain(|entry| !missing.contains(&entry.key));
        write_catalog(store, catalog)?;
    }
    Ok(CatalogView {
        profiles,
        cleanup_pending: !catalog.pending_delete.is_empty(),
        missing_removed,
    })
}
fn load_from(store: &impl Store, id: &str) -> Result<Credentials, String> {
    let catalog = catalog(store)?;
    let entry = catalog
        .entries
        .iter()
        .find(|e| e.id == id)
        .ok_or_else(|| "errors.savedConnectionMissing".to_string())?;
    read_credentials(store, &entry.key)
}
fn save_to(
    store: &impl Store,
    id: Option<String>,
    credentials: Credentials,
) -> Result<SavedConnection, String> {
    let mut catalog = catalog(store)?;
    let index = match &id {
        Some(id) => Some(
            catalog
                .entries
                .iter()
                .position(|e| &e.id == id)
                .ok_or_else(|| "errors.savedConnectionMissing".to_string())?,
        ),
        None => None,
    };
    let id = id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let key = format!("connection-v2-{}", uuid::Uuid::new_v4());
    // Journal the new credential before creating it, so failed writes and crashes
    // can be cleaned up on the next operation without losing any existing entry.
    catalog.pending_delete.push(key.clone());
    write_catalog(store, &catalog)?;
    store.write(
        &key,
        &serde_json::to_string(&credentials).map_err(|_| "errors.persistenceWrite".to_string())?,
    )?;
    catalog.pending_delete.retain(|pending| pending != &key);
    let entry = Entry {
        id: id.clone(),
        key,
    };
    if let Some(index) = index {
        catalog
            .pending_delete
            .push(catalog.entries[index].key.clone());
        catalog.entries[index] = entry;
    } else {
        catalog.entries.push(entry);
    }
    write_catalog(store, &catalog)?;
    cleanup(store, &mut catalog);
    Ok(public_profile(id, credentials))
}
fn remove_from(store: &impl Store, id: &str) -> Result<CatalogView, String> {
    let mut catalog = catalog(store)?;
    if let Some(index) = catalog.entries.iter().position(|e| e.id == id) {
        let entry = catalog.entries.remove(index);
        catalog.pending_delete.push(entry.key);
        write_catalog(store, &catalog)?;
    }
    cleanup(store, &mut catalog);
    view(store, &mut catalog)
}
async fn with_store<T: Send + 'static>(
    app: tauri::AppHandle,
    action: impl FnOnce(&SystemStore) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|_| "errors.persistenceUnavailable".to_string())?
        .join("connections-v2.json");
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = STORE_LOCK
            .lock()
            .map_err(|_| "errors.persistenceUnavailable".to_string())?;
        action(&SystemStore { path })
    })
    .await
    .map_err(|_| "errors.persistenceUnavailable".to_string())?
}
pub async fn resolve(
    app: tauri::AppHandle,
    mut credentials: Credentials,
    id: Option<String>,
    use_saved: bool,
) -> Result<Credentials, String> {
    if use_saved {
        let id = id.ok_or_else(|| "errors.savedConnectionMissing".to_string())?;
        let saved = with_store(app, move |store| load_from(store, &id)).await?;
        credentials.access_key_id = saved.access_key_id;
        credentials.access_key_secret = saved.access_key_secret;
        credentials.security_token = saved.security_token;
    }
    if credentials.access_key_id.trim().is_empty()
        || credentials.access_key_secret.trim().is_empty()
    {
        return Err("errors.emptyCredentials".into());
    }
    crate::oss::validate_region(&credentials.region)?;
    if !credentials.bucket.is_empty() {
        crate::oss::validate_bucket(&credentials.bucket)?;
    }
    Ok(credentials)
}
pub async fn save(
    app: tauri::AppHandle,
    id: Option<String>,
    credentials: Credentials,
) -> Result<SavedConnection, String> {
    with_store(app, move |store| save_to(store, id, credentials)).await
}
#[tauri::command]
pub async fn saved_connections(app: tauri::AppHandle) -> Result<CatalogView, String> {
    with_store(app, |store| {
        let mut catalog = catalog(store)?;
        view(store, &mut catalog)
    })
    .await
}
#[tauri::command]
pub async fn save_connection(
    app: tauri::AppHandle,
    credentials: Credentials,
    profile_id: Option<String>,
    use_saved: bool,
) -> Result<SavedConnection, String> {
    let credentials = resolve(app.clone(), credentials, profile_id.clone(), use_saved).await?;
    save(app, profile_id, credentials).await
}
#[tauri::command]
pub async fn forget_connection(
    app: tauri::AppHandle,
    profile_id: String,
) -> Result<CatalogView, String> {
    with_store(app, move |store| remove_from(store, &profile_id)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        cell::{Cell, RefCell},
        collections::HashMap,
    };
    #[derive(Default)]
    struct MemoryStore {
        data: RefCell<HashMap<String, String>>,
        writes: Cell<usize>,
        fail_index_at: Cell<usize>,
        fail_credentials: Cell<bool>,
        fail_remove: Cell<bool>,
    }
    impl Store for MemoryStore {
        fn read(&self, key: &str) -> Result<Option<String>, String> {
            Ok(self.data.borrow().get(key).cloned())
        }
        fn write(&self, key: &str, value: &str) -> Result<(), String> {
            if key == INDEX {
                self.writes.set(self.writes.get() + 1);
                if self.fail_index_at.get() == self.writes.get() {
                    return Err("errors.persistenceWrite".into());
                }
            } else if self.fail_credentials.get() {
                return Err("errors.persistenceWrite".into());
            }
            self.data.borrow_mut().insert(key.into(), value.into());
            Ok(())
        }
        fn remove(&self, key: &str) -> Result<(), String> {
            if self.fail_remove.get() {
                return Err("errors.persistenceRemove".into());
            }
            self.data.borrow_mut().remove(key);
            Ok(())
        }
    }
    fn fixture(name: &str) -> Credentials {
        Credentials {
            name: name.into(),
            region: "cn-hangzhou".into(),
            bucket: "test-bucket".into(),
            access_key_id: format!("id-{name}"),
            access_key_secret: format!("secret-{name}"),
            security_token: format!("token-{name}"),
        }
    }
    #[test]
    fn multiple_connections_edit_delete_and_secret_isolation() {
        let store = MemoryStore::default();
        let first = save_to(&store, None, fixture("one")).unwrap();
        let second = save_to(&store, None, fixture("two")).unwrap();
        let revised = save_to(&store, Some(first.id.clone()), fixture("renamed")).unwrap();
        assert_eq!(revised.id, first.id);
        assert_eq!(
            load_from(&store, &first.id).unwrap().access_key_secret,
            "secret-renamed"
        );
        assert_eq!(
            load_from(&store, &second.id).unwrap().access_key_secret,
            "secret-two"
        );
        let mut saved_catalog = catalog(&store).unwrap();
        let snapshot = view(&store, &mut saved_catalog).unwrap();
        assert_eq!(snapshot.profiles.len(), 2);
        let json = serde_json::to_string(&snapshot).unwrap();
        assert!(!json.contains("secret-"));
        assert!(!json.contains("token-"));
        let index = store.read(INDEX).unwrap().unwrap();
        assert!(!index.contains("test-bucket"));
        assert!(!index.contains("cn-hangzhou"));
        assert!(!index.contains("renamed"));
        remove_from(&store, &first.id).unwrap();
        assert!(load_from(&store, &first.id).is_err());
        assert_eq!(
            load_from(&store, &second.id).unwrap().access_key_secret,
            "secret-two"
        );
        assert_eq!(store.data.borrow().len(), 2, "one credential plus index");
    }
    #[test]
    fn missing_credentials_are_pruned_without_hiding_valid_profiles() {
        let store = MemoryStore::default();
        let missing = save_to(&store, None, fixture("missing")).unwrap();
        let valid = save_to(&store, None, fixture("valid")).unwrap();
        let missing_key = catalog(&store)
            .unwrap()
            .entries
            .into_iter()
            .find(|entry| entry.id == missing.id)
            .unwrap()
            .key;
        store.data.borrow_mut().remove(&missing_key);
        let mut saved_catalog = catalog(&store).unwrap();
        let snapshot = view(&store, &mut saved_catalog).unwrap();
        assert!(snapshot.missing_removed);
        assert_eq!(snapshot.profiles.len(), 1);
        assert_eq!(snapshot.profiles[0].id, valid.id);
        assert_eq!(catalog(&store).unwrap().entries.len(), 1);
        assert_eq!(
            load_from(&store, &valid.id).unwrap().access_key_secret,
            "secret-valid"
        );
    }
    #[test]
    fn legacy_connection_migrates_once_and_cannot_resurrect_after_deletion() {
        let store = MemoryStore::default();
        store
            .write(LEGACY, &serde_json::to_string(&fixture("legacy")).unwrap())
            .unwrap();
        let first = catalog(&store).unwrap();
        let id = first.entries[0].id.clone();
        assert_eq!(catalog(&store).unwrap().entries[0].id, id);
        assert_eq!(
            load_from(&store, &id).unwrap().security_token,
            "token-legacy"
        );
        save_to(&store, None, fixture("second")).unwrap();
        remove_from(&store, &id).unwrap();
        assert!(store.read(LEGACY).unwrap().is_none());
        store
            .write(
                LEGACY,
                &serde_json::to_string(&fixture("old-copy")).unwrap(),
            )
            .unwrap();
        assert_eq!(
            catalog(&store).unwrap().entries.len(),
            1,
            "existing index is authoritative"
        );
    }
    #[test]
    fn failed_index_commit_preserves_old_credentials_and_recovers_uncommitted_revision() {
        let store = MemoryStore::default();
        let first = save_to(&store, None, fixture("old")).unwrap();
        store.fail_index_at.set(store.writes.get() + 2);
        assert!(save_to(&store, Some(first.id.clone()), fixture("new")).is_err());
        assert_eq!(
            load_from(&store, &first.id).unwrap().access_key_secret,
            "secret-old"
        );
        assert!(catalog(&store).unwrap().pending_delete.is_empty());
        assert_eq!(store.data.borrow().len(), 2);
    }
    #[test]
    fn failed_credential_write_and_failed_delete_commit_leave_existing_profiles_intact() {
        let store = MemoryStore::default();
        let first = save_to(&store, None, fixture("old")).unwrap();
        store.fail_credentials.set(true);
        assert!(save_to(&store, Some(first.id.clone()), fixture("new")).is_err());
        assert_eq!(
            load_from(&store, &first.id).unwrap().access_key_secret,
            "secret-old"
        );
        store.fail_index_at.set(store.writes.get() + 1);
        assert!(remove_from(&store, &first.id).is_err());
        assert_eq!(
            load_from(&store, &first.id).unwrap().access_key_secret,
            "secret-old"
        );
    }
    #[test]
    fn interrupted_cleanup_is_visible_and_retried_without_affecting_other_credentials() {
        let store = MemoryStore::default();
        let first = save_to(&store, None, fixture("one")).unwrap();
        let second = save_to(&store, None, fixture("two")).unwrap();
        store.fail_remove.set(true);
        let result = remove_from(&store, &first.id).unwrap();
        assert!(result.cleanup_pending);
        assert_eq!(result.profiles.len(), 1);
        store.fail_remove.set(false);
        let recovered = catalog(&store).unwrap();
        assert!(recovered.pending_delete.is_empty());
        assert_eq!(
            load_from(&store, &second.id).unwrap().access_key_secret,
            "secret-two"
        );
        assert_eq!(store.data.borrow().len(), 2);
    }
    #[test]
    fn corrupted_catalog_never_reads_or_deletes_arbitrary_keychain_entries() {
        let store = MemoryStore::default();
        store
            .write(
                INDEX,
                "{\"version\":2,\"entries\":[],\"pending_delete\":[\"unrelated-account\"]}",
            )
            .unwrap();
        store.write("unrelated-account", "private").unwrap();
        assert_eq!(catalog(&store).err().unwrap(), "errors.persistenceCorrupt");
        assert_eq!(store.read("unrelated-account").unwrap().unwrap(), "private");
    }
    #[test]
    fn public_index_can_be_atomically_replaced_without_accessing_the_keychain() {
        let dir = tempfile::tempdir().unwrap();
        let store = SystemStore {
            path: dir.path().join("nested/connections-v2.json"),
        };
        assert!(store.read(INDEX).unwrap().is_none());
        store.write(INDEX, "first").unwrap();
        store.write(INDEX, "second").unwrap();
        assert_eq!(store.read(INDEX).unwrap().unwrap(), "second");
    }
    #[test]
    fn owner_only_fallback_survives_a_fresh_store_instance() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("app-data/connections-v2.json");
        let key = "connection-v2-00000000-0000-4000-8000-000000000000";
        let first = SystemStore { path: path.clone() };
        let credential_path = first.credential_path(key).unwrap();
        atomic_write(&credential_path, "durable-secret").unwrap();
        let reopened = SystemStore { path };
        assert_eq!(reopened.read(key).unwrap().unwrap(), "durable-secret");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&credential_path)
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
            assert_eq!(
                std::fs::metadata(credential_path.parent().unwrap())
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
        }
    }
}
