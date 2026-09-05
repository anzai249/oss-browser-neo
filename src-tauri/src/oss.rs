use chrono::Utc;
use hmac::{Hmac, Mac};
use reqwest::{Client, Method};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, sync::Mutex, time::Duration};
use tauri::State;
use tauri_plugin_dialog::DialogExt;

const MAX_FILE_SIZE: usize = 100 * 1024 * 1024;
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    #[serde(default)]
    pub(crate) name: String,
    pub(crate) access_key_id: String,
    pub(crate) access_key_secret: String,
    #[serde(default)]
    pub(crate) security_token: String,
    pub(crate) region: String,
    #[serde(default)]
    pub(crate) bucket: String,
}
#[derive(Default)]
pub struct OssState(pub Mutex<Option<Credentials>>);
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct BucketXml {
    name: String,
    #[serde(default)]
    location: String,
    #[serde(default)]
    creation_date: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bucket {
    name: String,
    region: String,
    creation_date: String,
}
#[derive(Default, Deserialize)]
struct BucketCollection {
    #[serde(rename = "Bucket", default)]
    buckets: Vec<BucketXml>,
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct BucketList {
    #[serde(default)]
    buckets: BucketCollection,
    #[serde(default)]
    is_truncated: bool,
    #[serde(default)]
    next_marker: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct ObjectXml {
    key: String,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    last_modified: String,
    #[serde(default)]
    storage_class: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct CommonPrefix {
    prefix: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct ObjectList {
    #[serde(rename = "Contents", default)]
    contents: Vec<ObjectXml>,
    #[serde(rename = "CommonPrefixes", default)]
    prefixes: Vec<CommonPrefix>,
    #[serde(default)]
    is_truncated: bool,
    #[serde(default)]
    next_continuation_token: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Object {
    key: String,
    size: u64,
    last_modified: String,
    storage_class: String,
    is_folder: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectPage {
    objects: Vec<Object>,
    next_marker: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct OssError {
    code: String,
    message: String,
    #[serde(default)]
    request_id: String,
}

fn credentials(state: &State<'_, OssState>) -> Result<Credentials, String> {
    state
        .0
        .lock()
        .map_err(|_| "errors.stateUnavailable".to_string())?
        .clone()
        .ok_or_else(|| "errors.notConnected".to_string())
}
pub(crate) fn validate_region(region: &str) -> Result<String, String> {
    let region = region.strip_prefix("oss-").unwrap_or(region);
    if region.is_empty()
        || !region
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
    {
        return Err("errors.invalidRegion".into());
    }
    Ok(region.into())
}
pub(crate) fn validate_bucket(bucket: &str) -> Result<(), String> {
    if !(3..=63).contains(&bucket.len())
        || !bucket
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
        || bucket.starts_with('-')
        || bucket.ends_with('-')
    {
        return Err("errors.invalidBucket".into());
    }
    Ok(())
}
fn validate_key(key: &str) -> Result<(), String> {
    if key.len() > 1023
        || key.chars().any(char::is_control)
        || key.split('/').any(|p| p == "." || p == "..")
    {
        return Err("errors.invalidKey".into());
    }
    Ok(())
}
fn encode(value: &str, slash: bool) -> String {
    let mut result = String::new();
    for b in value.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) || (slash && b == b'/') {
            result.push(b as char);
        } else {
            result.push_str(&format!("%{b:02X}"));
        }
    }
    result
}
fn canonical_query(query: &[(&str, String)]) -> String {
    let sorted: BTreeMap<String, String> = query
        .iter()
        .map(|(k, v)| (encode(k, false), encode(v, false)))
        .collect();
    sorted
        .into_iter()
        .map(|(k, v)| if v.is_empty() { k } else { format!("{k}={v}") })
        .collect::<Vec<_>>()
        .join("&")
}
fn hmac(key: &[u8], value: &str) -> Vec<u8> {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC accepts arbitrary key sizes");
    mac.update(value.as_bytes());
    mac.finalize().into_bytes().to_vec()
}
fn signing_key(secret: &str, date: &str, region: &str) -> Vec<u8> {
    hmac(
        &hmac(
            &hmac(&hmac(format!("aliyun_v4{secret}").as_bytes(), date), region),
            "oss",
        ),
        "aliyun_v4_request",
    )
}
fn authorization(
    c: &Credentials,
    method: &str,
    resource: &str,
    query: &str,
    headers: &BTreeMap<String, String>,
    timestamp: &str,
    region: &str,
) -> String {
    let canonical_headers = headers
        .iter()
        .map(|(k, v)| format!("{}:{}\n", k.to_lowercase(), v.trim()))
        .collect::<String>();
    let canonical = format!(
        "{method}\n{}\n{query}\n{canonical_headers}\n\nUNSIGNED-PAYLOAD",
        encode(resource, true)
    );
    let scope = format!("{}/{region}/oss/aliyun_v4_request", &timestamp[..8]);
    let to_sign = format!(
        "OSS4-HMAC-SHA256\n{timestamp}\n{scope}\n{}",
        hex::encode(Sha256::digest(canonical.as_bytes()))
    );
    let signature = hex::encode(hmac(
        &signing_key(&c.access_key_secret, &timestamp[..8], region),
        &to_sign,
    ));
    format!(
        "OSS4-HMAC-SHA256 Credential={}/{scope},Signature={signature}",
        c.access_key_id
    )
}
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RequestOptions {
    timeout_seconds: u64,
    read_retries: u8,
}
impl Default for RequestOptions {
    fn default() -> Self {
        Self {
            timeout_seconds: 300,
            read_retries: 1,
        }
    }
}
impl RequestOptions {
    fn retries_for(&self, method: &Method) -> u8 {
        if *method == Method::GET || *method == Method::HEAD {
            self.read_retries
        } else {
            0
        }
    }
    fn validate(&self) -> Result<(), String> {
        if !(30..=600).contains(&self.timeout_seconds) || self.read_retries > 3 {
            return Err("errors.invalidRequestOptions".into());
        }
        Ok(())
    }
}
fn retryable_status(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
}

async fn request(
    c: &Credentials,
    method: Method,
    bucket: &str,
    region: &str,
    key: &str,
    query: &[(&str, String)],
    body: Option<Vec<u8>>,
    content_type: &str,
    options: &RequestOptions,
) -> Result<reqwest::Response, String> {
    options.validate()?;
    let region = validate_region(region)?;
    if !bucket.is_empty() {
        validate_bucket(bucket)?;
    }
    validate_key(key)?;
    let host = if bucket.is_empty() {
        format!("oss-{region}.aliyuncs.com")
    } else {
        format!("{bucket}.oss-{region}.aliyuncs.com")
    };
    let resource = if bucket.is_empty() {
        "/".into()
    } else {
        format!("/{bucket}/{key}")
    };
    let query = canonical_query(query);
    let url = format!(
        "https://{host}/{}{}",
        encode(key, true),
        if query.is_empty() {
            String::new()
        } else {
            format!("?{query}")
        }
    );
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(options.timeout_seconds))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "errors.httpClient".to_string())?;
    // Mutating requests are never retried: a lost response may follow a successful write.
    let retries = options.retries_for(&method);
    let mut body = body;
    for attempt in 0..=retries {
        let timestamp = Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
        let mut headers = BTreeMap::from([
            ("x-oss-content-sha256".into(), "UNSIGNED-PAYLOAD".into()),
            ("x-oss-date".into(), timestamp.clone()),
        ]);
        if !c.security_token.is_empty() {
            headers.insert("x-oss-security-token".into(), c.security_token.clone());
        }
        if body.is_some() {
            headers.insert("content-type".into(), content_type.into());
            headers.insert("x-oss-forbid-overwrite".into(), "true".into());
        }
        let auth = authorization(
            c,
            method.as_str(),
            &resource,
            &query,
            &headers,
            &timestamp,
            &region,
        );
        let mut req = client
            .request(method.clone(), &url)
            .header("Authorization", auth);
        for (key, value) in headers {
            req = req.header(key, value);
        }
        if let Some(bytes) = body.take() {
            req = req.body(bytes);
        }
        match req.send().await {
            Err(e) => {
                if attempt == retries || !(e.is_connect() || e.is_timeout()) {
                    return Err(if e.is_timeout() {
                        "errors.timeout"
                    } else {
                        "errors.network"
                    }
                    .into());
                }
            }
            Ok(response) => {
                if response.status().is_success() {
                    return Ok(response);
                }
                if attempt == retries || !retryable_status(response.status()) {
                    let status = response.status();
                    let text = read_limited(response, 1024 * 1024).await?;
                    return Err(quick_xml::de::from_reader::<_, OssError>(text.as_slice())
                        .map(|e| {
                            format!("{}: {} (Request ID: {})", e.code, e.message, e.request_id)
                        })
                        .unwrap_or_else(|_| format!("errors.httpStatus|{status}")));
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(250 * (1 << attempt))).await;
    }
    Err("errors.network".into())
}

async fn read_limited(mut response: reqwest::Response, limit: usize) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .is_some_and(|len| len > limit as u64)
    {
        return Err("errors.responseLimit".into());
    }
    let mut data = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "errors.interrupted".to_string())?
    {
        if data.len() + chunk.len() > limit {
            return Err("errors.responseLimit".into());
        }
        data.extend_from_slice(&chunk);
    }
    Ok(data)
}
async fn list_page(
    c: &Credentials,
    bucket: &str,
    region: &str,
    prefix: &str,
    marker: &str,
    page_size: u16,
    options: &RequestOptions,
) -> Result<ObjectPage, String> {
    if !(1..=1000).contains(&page_size) {
        return Err("errors.invalidPageSize".into());
    }
    let mut query = vec![
        ("list-type", "2".into()),
        ("delimiter", "/".into()),
        ("max-keys", page_size.to_string()),
    ];
    if !prefix.is_empty() {
        query.push(("prefix", prefix.into()));
    }
    if !marker.is_empty() {
        query.push(("continuation-token", marker.into()));
    }
    let bytes = read_limited(
        request(
            c,
            Method::GET,
            bucket,
            region,
            "",
            &query,
            None,
            "",
            options,
        )
        .await?,
        5 * 1024 * 1024,
    )
    .await?;
    let result: ObjectList = quick_xml::de::from_reader(bytes.as_slice())
        .map_err(|_| "errors.objectListParse".to_string())?;
    if result.is_truncated && result.next_continuation_token.is_empty() {
        return Err("errors.objectPagination".into());
    }
    let mut objects: Vec<Object> = result
        .prefixes
        .into_iter()
        .map(|p| Object {
            key: p.prefix,
            size: 0,
            last_modified: String::new(),
            storage_class: String::new(),
            is_folder: true,
        })
        .collect();
    objects.extend(
        result
            .contents
            .into_iter()
            .filter(|o| o.key != prefix)
            .map(|o| Object {
                is_folder: o.key.ends_with('/'),
                key: o.key,
                size: o.size,
                last_modified: o.last_modified,
                storage_class: o.storage_class,
            }),
    );
    objects.sort_by(|a, b| a.key.cmp(&b.key));
    objects.dedup_by(|a, b| a.key == b.key);
    Ok(ObjectPage {
        objects,
        next_marker: if result.is_truncated {
            result.next_continuation_token
        } else {
            String::new()
        },
    })
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionResult {
    buckets: Vec<Bucket>,
    profile_id: Option<String>,
}
#[tauri::command]
pub async fn connect_oss(
    credentials: Credentials,
    profile_id: Option<String>,
    app: tauri::AppHandle,
    remember: bool,
    use_saved: bool,
    options: Option<RequestOptions>,
    state: State<'_, OssState>,
) -> Result<ConnectionResult, String> {
    let options = options.unwrap_or_default();
    options.validate()?;
    let credentials =
        crate::connections::resolve(app.clone(), credentials, profile_id.clone(), use_saved)
            .await?;
    let region = validate_region(&credentials.region)?;
    let mut buckets = Vec::new();
    if !credentials.bucket.is_empty() {
        validate_bucket(&credentials.bucket)?;
        list_page(
            &credentials,
            &credentials.bucket,
            &region,
            "",
            "",
            1,
            &options,
        )
        .await?;
        buckets.push(Bucket {
            name: credentials.bucket.clone(),
            region: format!("oss-{region}"),
            creation_date: String::new(),
        });
    } else {
        let mut marker = String::new();
        loop {
            let mut query = vec![("max-keys", "1000".into())];
            if !marker.is_empty() {
                query.push(("marker", marker.clone()));
            }
            let bytes = read_limited(
                request(
                    &credentials,
                    Method::GET,
                    "",
                    &region,
                    "",
                    &query,
                    None,
                    "",
                    &options,
                )
                .await?,
                5 * 1024 * 1024,
            )
            .await?;
            let list: BucketList = quick_xml::de::from_reader(bytes.as_slice())
                .map_err(|_| "errors.bucketListParse".to_string())?;
            buckets.extend(list.buckets.buckets.into_iter().map(|b| Bucket {
                name: b.name,
                region: b.location,
                creation_date: b.creation_date,
            }));
            if !list.is_truncated {
                break;
            }
            if list.next_marker.is_empty() || marker == list.next_marker {
                return Err("errors.bucketPagination".into());
            }
            marker = list.next_marker;
        }
    }
    if buckets.is_empty() {
        return Err("errors.noBuckets".into());
    }
    let profile_id = if remember {
        Some(
            crate::connections::save(app, profile_id, credentials.clone())
                .await?
                .id,
        )
    } else if use_saved {
        profile_id
    } else {
        None
    };
    *state
        .0
        .lock()
        .map_err(|_| "errors.saveConnection".to_string())? = Some(credentials);
    Ok(ConnectionResult {
        buckets,
        profile_id,
    })
}
#[tauri::command]
pub fn disconnect_oss(state: State<'_, OssState>) -> Result<(), String> {
    *state
        .0
        .lock()
        .map_err(|_| "errors.clearConnection".to_string())? = None;
    Ok(())
}
#[tauri::command]
pub async fn list_objects(
    bucket: String,
    region: String,
    prefix: String,
    marker: String,
    page_size: Option<u16>,
    options: Option<RequestOptions>,
    state: State<'_, OssState>,
) -> Result<ObjectPage, String> {
    list_page(
        &credentials(&state)?,
        &bucket,
        &region,
        &prefix,
        &marker,
        page_size.unwrap_or(100),
        &options.unwrap_or_default(),
    )
    .await
}
#[tauri::command]
pub async fn put_object(
    bucket: String,
    region: String,
    key: String,
    data: Vec<u8>,
    content_type: String,
    options: Option<RequestOptions>,
    state: State<'_, OssState>,
) -> Result<(), String> {
    if key.is_empty() {
        return Err("errors.emptyKey".into());
    }
    if data.len() > MAX_FILE_SIZE {
        return Err("errors.fileLimit".into());
    }
    request(
        &credentials(&state)?,
        Method::PUT,
        &bucket,
        &region,
        &key,
        &[],
        Some(data),
        &content_type,
        &options.unwrap_or_default(),
    )
    .await?;
    Ok(())
}
#[tauri::command]
pub async fn delete_object(
    options: Option<RequestOptions>,
    bucket: String,
    region: String,
    key: String,
    state: State<'_, OssState>,
) -> Result<(), String> {
    if key.is_empty() {
        return Err("errors.deleteRoot".into());
    }
    let c = credentials(&state)?;
    let options = options.unwrap_or_default();
    if key.ends_with('/') {
        let page = list_page(&c, &bucket, &region, &key, "", 1, &options).await?;
        if !page.objects.is_empty() || !page.next_marker.is_empty() {
            return Err("errors.folderNotEmpty".into());
        }
    }
    request(
        &c,
        Method::DELETE,
        &bucket,
        &region,
        &key,
        &[],
        None,
        "",
        &options,
    )
    .await?;
    Ok(())
}
#[tauri::command]
pub async fn download_object(
    options: Option<RequestOptions>,
    bucket: String,
    region: String,
    key: String,
    app: tauri::AppHandle,
    state: State<'_, OssState>,
) -> Result<bool, String> {
    if key.is_empty() || key.ends_with('/') {
        return Err("errors.folderDownload".into());
    }
    let c = credentials(&state)?;
    let filename = key.rsplit('/').next().unwrap_or("download").to_owned();
    let path = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_file_name(filename)
            .blocking_save_file()
    })
    .await
    .map_err(|_| "errors.saveDialog".to_string())?;
    let Some(path) = path else {
        return Ok(false);
    };
    let path = path
        .into_path()
        .map_err(|_| "errors.savePath".to_string())?;
    let bytes = read_limited(
        request(
            &c,
            Method::GET,
            &bucket,
            &region,
            &key,
            &[],
            None,
            "",
            &options.unwrap_or_default(),
        )
        .await?,
        MAX_FILE_SIZE,
    )
    .await?;
    tauri::async_runtime::spawn_blocking(move || std::fs::write(path, bytes))
        .await
        .map_err(|_| "errors.downloadFailed".to_string())?
        .map_err(|e| format!("errors.saveFile|{e}"))?;
    Ok(true)
}

const MAX_PREVIEW_SIZE: usize = 10 * 1024 * 1024;
pub struct PreviewState(tokio::sync::watch::Sender<u64>);
impl Default for PreviewState {
    fn default() -> Self {
        Self(tokio::sync::watch::channel(0).0)
    }
}
impl PreviewState {
    fn advance(&self, generation: u64) {
        self.0.send_if_modified(|current| {
            if generation <= *current {
                return false;
            }
            *current = generation;
            true
        });
    }
}
fn preview_supported(key: &str) -> bool {
    matches!(
        key.rsplit('.')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "avif" | "svg"
    )
}
#[tauri::command]
pub fn cancel_preview(generation: u64, preview: State<'_, PreviewState>) {
    preview.advance(generation);
}
#[tauri::command]
pub async fn preview_image(
    bucket: String,
    region: String,
    key: String,
    generation: u64,
    options: Option<RequestOptions>,
    state: State<'_, OssState>,
    preview: State<'_, PreviewState>,
) -> Result<tauri::ipc::Response, String> {
    if !preview_supported(&key) || key.ends_with('/') {
        return Err("errors.previewUnsupported".into());
    }
    let c = credentials(&state)?;
    let mut changes = preview.0.subscribe();
    preview.advance(generation);
    if *changes.borrow_and_update() != generation {
        return Err("errors.previewCancelled".into());
    }
    let options = options.unwrap_or_default();
    tokio::select! {
        biased;
        _ = changes.changed() => Err("errors.previewCancelled".into()),
        result = async {
            let response = request(&c, Method::GET, &bucket, &region, &key, &[], None, "", &options).await?;
            if response.content_length().is_some_and(|n| n > MAX_PREVIEW_SIZE as u64) {
                return Err("errors.previewTooLarge".into());
            }
            read_limited(response, MAX_PREVIEW_SIZE).await.map_err(|e| {
                if e == "errors.responseLimit" { "errors.previewTooLarge".into() } else { e }
            })
        } => result.map(tauri::ipc::Response::new),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn network_settings_reject_invalid_values_and_never_retry_writes() {
        let options = RequestOptions {
            timeout_seconds: 60,
            read_retries: 3,
        };
        assert!(options.validate().is_ok());
        assert_eq!(options.retries_for(&Method::GET), 3);
        assert_eq!(options.retries_for(&Method::HEAD), 3);
        for method in [Method::PUT, Method::DELETE, Method::POST] {
            assert_eq!(options.retries_for(&method), 0);
        }
        assert!(RequestOptions {
            timeout_seconds: 0,
            ..options
        }
        .validate()
        .is_err());
        assert!(RequestOptions {
            read_retries: 4,
            ..options
        }
        .validate()
        .is_err());
        assert!(retryable_status(reqwest::StatusCode::TOO_MANY_REQUESTS));
        assert!(retryable_status(reqwest::StatusCode::SERVICE_UNAVAILABLE));
        assert!(!retryable_status(reqwest::StatusCode::FORBIDDEN));
        assert!(!retryable_status(reqwest::StatusCode::NOT_FOUND));
    }
    #[test]
    fn preview_generation_cancels_reads_and_ignores_late_commands() {
        let state = PreviewState::default();
        state.advance(10);
        let mut pending = state.0.subscribe();
        state.advance(11);
        assert!(pending.has_changed().unwrap());
        assert_eq!(*pending.borrow_and_update(), 11);
        state.advance(9);
        state.advance(10);
        assert!(!pending.has_changed().unwrap());
        assert_eq!(*pending.borrow(), 11);
        state.advance(12);
        assert!(pending.has_changed().unwrap());
        assert_eq!(*pending.borrow_and_update(), 12);
    }
    #[test]
    fn preview_accepts_supported_image_extensions_only() {
        for name in ["folder/a.PNG", "a.jpeg", "a.svg", "a.webp", "a.avif"] {
            assert!(preview_supported(name));
        }
        for name in ["a.html", "a.pdf", "a.png.exe", "no-extension"] {
            assert!(!preview_supported(name));
        }
    }
    // Public test vectors from aliyun/alibabacloud-oss-python-sdk-v2,
    // tests/unit/signer/test_v4.py (AccessKey strings are dummy fixtures).
    #[test]
    fn official_sdk_v4_signing_fixtures() {
        let query = canonical_query(&[
            ("param1", "value1".into()),
            ("+param1", "value3".into()),
            ("|param1", "value4".into()),
            ("+param2", "".into()),
            ("|param2", "".into()),
            ("param2", "".into()),
        ]);
        for (seconds, token, expected) in [
            (
                1702743657,
                "",
                "e21d18daa82167720f9b1047ae7e7f1ce7cb77a31e8203a7d5f4624fa0284afe",
            ),
            (
                1702784856,
                "token",
                "b94a3f999cf85bcdc00d332fbd3734ba03e48382c36fa4d5af5df817395bd9ea",
            ),
        ] {
            let timestamp = chrono::DateTime::from_timestamp(seconds, 0)
                .unwrap()
                .format("%Y%m%dT%H%M%SZ")
                .to_string();
            let c = Credentials {
                name: String::new(),
                access_key_id: "ak".into(),
                access_key_secret: "sk".into(),
                security_token: token.into(),
                region: "cn-hangzhou".into(),
                bucket: "bucket".into(),
            };
            let mut headers = BTreeMap::from([
                ("x-oss-head1".into(), "value".into()),
                ("content-type".into(), "text/plain".into()),
                ("x-oss-content-sha256".into(), "UNSIGNED-PAYLOAD".into()),
                ("x-oss-date".into(), timestamp.clone()),
            ]);
            if !token.is_empty() {
                headers.insert("x-oss-security-token".into(), token.into());
            }
            assert_eq!(authorization(&c, "PUT", "/bucket/1234+-/123/1.txt", &query, &headers, &timestamp, "cn-hangzhou"), format!("OSS4-HMAC-SHA256 Credential=ak/{}/cn-hangzhou/oss/aliyun_v4_request,Signature={expected}", &timestamp[..8]));
        }
    }
    #[test]
    fn unicode_and_query_encoding() {
        assert_eq!(
            encode("/bucket/品牌/hello world+%.txt", true),
            "/bucket/%E5%93%81%E7%89%8C/hello%20world%2B%25.txt"
        );
        assert_eq!(
            canonical_query(&[("prefix", "a b/".into()), ("list-type", "2".into())]),
            "list-type=2&prefix=a%20b%2F"
        );
        assert!(validate_region("cn-hangzhou.evil.com").is_err());
        assert!(validate_bucket("bad/name").is_err());
        assert!(validate_key("folder/../name").is_err());
    }
    #[test]
    fn parse_realistic_list_response() {
        let xml = r#"<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>abc+/=</NextContinuationToken><Contents><Key>images/a&amp;b.png</Key><Size>125</Size><LastModified>2026-09-04T08:30:00.000Z</LastModified><StorageClass>Standard</StorageClass></Contents><CommonPrefixes><Prefix>品牌/</Prefix></CommonPrefixes></ListBucketResult>"#;
        let result: ObjectList = quick_xml::de::from_str(xml).unwrap();
        assert_eq!(result.contents[0].key, "images/a&b.png");
        assert_eq!(result.prefixes[0].prefix, "品牌/");
        assert_eq!(result.next_continuation_token, "abc+/=");
        assert!(result.is_truncated);
    }
}
