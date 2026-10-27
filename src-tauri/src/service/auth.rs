use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use reqwest::{Client, Method, Response, StatusCode, Url};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;

pub struct AuthService {
    pending: Mutex<HashMap<String, PendingLogin>>,
    tokens: Mutex<Option<TokenSession>>,
    next_id: AtomicU64,
    invalidated: AtomicBool,
    endpoint: Option<String>,
    vault: Arc<dyn CredentialVault>,
}

impl Default for AuthService {
    fn default() -> Self {
        let endpoint = std::env::var("DSH_AUTH_API_BASE_URL")
            .unwrap_or_else(|_| "http://bcw-test.jinmit.com".into());
        let environment = if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        };
        let digest = format!(
            "{:x}",
            Sha256::digest(endpoint.trim_end_matches('/').as_bytes())
        );
        Self {
            pending: Mutex::new(HashMap::new()),
            tokens: Mutex::new(None),
            next_id: AtomicU64::new(0),
            invalidated: AtomicBool::new(false),
            endpoint: Some(endpoint),
            vault: Arc::new(SystemVault {
                service: format!(
                    "{}.desktop-auth.{environment}.{}",
                    env!("DSH_APP_IDENTIFIER"),
                    &digest[..16]
                ),
            }),
        }
    }
}

enum VaultAction {
    Read,
    Write(Vec<u8>),
    Delete,
}

#[async_trait::async_trait]
trait CredentialVault: Send + Sync {
    async fn access(&self, key: String, action: VaultAction) -> Result<Option<Vec<u8>>, String>;
}

struct SystemVault {
    service: String,
}

#[async_trait::async_trait]
impl CredentialVault for SystemVault {
    async fn access(&self, key: String, action: VaultAction) -> Result<Option<Vec<u8>>, String> {
        let service = self.service.clone();
        tokio::task::spawn_blocking(move || {
            let entry = keyring::Entry::new(&service, &key)
                .map_err(|_| "DESKTOP_AUTH_VAULT_UNAVAILABLE")?;
            let result = match action {
                VaultAction::Read => entry.get_secret().map(Some),
                VaultAction::Write(bytes) => {
                    return entry
                        .set_secret(&bytes)
                        .map(|_| None)
                        .map_err(|_| "DESKTOP_AUTH_VAULT_UNAVAILABLE".into())
                }
                VaultAction::Delete => entry.delete_credential().map(|_| None),
            };
            match result {
                Ok(value) => Ok(value),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(_) => Err("DESKTOP_AUTH_VAULT_UNAVAILABLE".into()),
            }
        })
        .await
        .map_err(|_| "DESKTOP_AUTH_VAULT_UNAVAILABLE")?
    }
}

struct PendingLogin {
    id: u64,
    nonce: String,
    claiming: bool,
}

#[derive(Deserialize, Serialize)]
struct PendingSecret {
    nonce: String,
    claim_key: String,
}

struct TokenSession {
    data: TokenResponse,
    expires: Instant,
    refresh_expires: Instant,
    refresh_expires_at: u64,
    public: AuthSession,
    persisted: bool,
}

#[derive(Deserialize, Serialize)]
struct SavedTokens {
    data: TokenResponse,
    expires_at: u64,
    refresh_expires_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthSession {
    pub employee_number: String,
    pub employee_name: String,
    pub expires_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginQr {
    pub login_id: u64,
    pub auth_url: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmployeeInfo {
    employee_number: String,
    employee_name: String,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum ClaimResult {
    Pending,
    Expired,
    Cancelled,
    Authenticated { session: AuthSession },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BeginResponse {
    nonce: String,
    claim_key: String,
    auth_url: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    token_type: String,
    expires_in: u64,
    refresh_expires_in: u64,
    employee_number: String,
    employee_name: String,
}

impl AuthService {
    fn endpoint(&self) -> Result<Url, String> {
        let url = Url::parse(
            self.endpoint
                .as_deref()
                .unwrap_or("http://bcw-test.jinmit.com"),
        )
        .map_err(|_| "DESKTOP_AUTH_CONFIG_INVALID")?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url.path() != "/"
        {
            return Err("DESKTOP_AUTH_CONFIG_INVALID".into());
        }
        Ok(url)
    }

    async fn send(
        &self,
        method: Method,
        path: &str,
        body: &Value,
        token: Option<&str>,
    ) -> Result<Response, String> {
        let base = self.endpoint()?;
        let url = base
            .join(path)
            .map_err(|_| "DESKTOP_AUTH_REQUEST_INVALID")?;
        if url.origin() != base.origin() {
            return Err("DESKTOP_AUTH_REQUEST_INVALID".into());
        }
        let mut request = Client::builder()
            .timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| "DESKTOP_AUTH_NETWORK")?
            .request(method, url);
        if !body.is_null() {
            request = request.json(body);
        }
        if let Some(token) = token {
            request = request.bearer_auth(token);
        }
        request
            .send()
            .await
            .map_err(|_| "DESKTOP_AUTH_NETWORK".into())
    }

    async fn post(&self, path: &str, body: Value) -> Result<Response, String> {
        self.send(Method::POST, path, &body, None).await
    }

    async fn read_secret<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>, String> {
        self.vault
            .access(key.into(), VaultAction::Read)
            .await?
            .map(|bytes| {
                serde_json::from_slice(&bytes).map_err(|_| "DESKTOP_AUTH_VAULT_INVALID".into())
            })
            .transpose()
    }

    async fn save_secret<T: Serialize + Sync>(&self, key: &str, value: &T) -> Result<(), String> {
        let bytes = serde_json::to_vec(value).map_err(|_| "DESKTOP_AUTH_VAULT_INVALID")?;
        self.vault
            .access(key.into(), VaultAction::Write(bytes))
            .await?;
        Ok(())
    }

    async fn persist(&self, tokens: &mut TokenSession) -> Result<(), String> {
        if !tokens.persisted {
            self.save_secret(
                "session",
                &SavedTokens {
                    data: tokens.data.clone(),
                    expires_at: tokens.public.expires_at,
                    refresh_expires_at: tokens.refresh_expires_at,
                },
            )
            .await?;
            tokens.persisted = true;
        }
        Ok(())
    }

    pub async fn begin(&self, owner: &str, platform: &str) -> Result<Option<LoginQr>, String> {
        if !matches!(platform, "dingtalk" | "wecom") {
            return Err("DESKTOP_AUTH_REQUEST_INVALID".into());
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        {
            let mut pending = self.pending.lock().await;
            pending.remove(owner);
            self.vault
                .access(format!("pending:{owner}"), VaultAction::Delete)
                .await?;
            pending.insert(
                owner.into(),
                PendingLogin {
                    id,
                    nonce: String::new(),
                    claiming: false,
                },
            );
        }
        let result = async {
            let response = self
                .post("/desktop/api/begin", json!({ "platform": platform }))
                .await?;
            if response.status() == StatusCode::BAD_REQUEST {
                let error: Value = read_json(response).await?;
                if error.get("error").and_then(Value::as_str) == Some("invalid_request") {
                    let description = error
                        .get("error_description")
                        .and_then(Value::as_str)
                        .filter(|text| !text.trim().is_empty())
                        .unwrap_or("invalid_request");
                    return Err(format!("DESKTOP_AUTH_BEGIN_REJECTED: {description}"));
                }
                return Err("DESKTOP_AUTH_BEGIN_FAILED".into());
            }
            if response.status() != StatusCode::OK {
                return Err("DESKTOP_AUTH_BEGIN_FAILED".into());
            }
            let body: Value = read_json(response).await?;
            let data: BeginResponse =
                serde_json::from_value(body).map_err(|_| "DESKTOP_AUTH_RESPONSE_INVALID")?;
            let auth_url = data
                .auth_url
                .filter(|url| !url.trim().is_empty())
                .ok_or("DESKTOP_AUTH_AUTH_URL_MISSING")?;
            let url = Url::parse(&auth_url).map_err(|_| "DESKTOP_AUTH_RESPONSE_INVALID")?;
            if !matches!(url.scheme(), "http" | "https")
                || url.host_str().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
                || data.nonce.trim().is_empty()
                || data.claim_key.trim().is_empty()
            {
                return Err("DESKTOP_AUTH_RESPONSE_INVALID".into());
            }
            Ok((data.nonce, data.claim_key, auth_url))
        }
        .await;
        let mut pending = self.pending.lock().await;
        let Some(ticket) = pending.get_mut(owner).filter(|ticket| ticket.id == id) else {
            return Ok(None);
        };
        match result {
            Ok((nonce, key, auth_url)) => {
                let secret = PendingSecret {
                    nonce: nonce.clone(),
                    claim_key: key,
                };
                if let Err(error) = self.save_secret(&format!("pending:{owner}"), &secret).await {
                    pending.remove(owner);
                    return Err(error);
                }
                ticket.nonce = nonce;
                Ok(Some(LoginQr {
                    login_id: id,
                    auth_url,
                }))
            }
            Err(error) => {
                pending.remove(owner);
                Err(error)
            }
        }
    }

    pub async fn cancel(&self, owner: &str) -> Result<(), String> {
        let mut pending = self.pending.lock().await;
        pending.remove(owner);
        self.vault
            .access(format!("pending:{owner}"), VaultAction::Delete)
            .await?;
        Ok(())
    }

    pub async fn logout(&self) -> Result<u64, String> {
        let mut tokens = self.tokens.lock().await;
        let mut pending = self.pending.lock().await;
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        self.invalidated.store(true, Ordering::Relaxed);
        *tokens = None;
        for ticket in pending.values_mut() {
            ticket.id = 0;
            ticket.nonce.clear();
            ticket.claiming = false;
        }
        let mut result = self
            .vault
            .access("session".into(), VaultAction::Delete)
            .await
            .map(|_| id);
        let owners: Vec<_> = pending.keys().cloned().collect();
        for owner in owners {
            match self
                .vault
                .access(format!("pending:{owner}"), VaultAction::Delete)
                .await
            {
                Ok(_) => {
                    pending.remove(&owner);
                }
                Err(error) => result = Err(error),
            }
        }
        result
    }

    pub async fn claim(&self, owner: &str, login_id: u64) -> Result<ClaimResult, String> {
        let body = {
            let mut pending = self.pending.lock().await;
            let Some(ticket) = pending
                .get_mut(owner)
                .filter(|ticket| ticket.id == login_id)
            else {
                return Ok(ClaimResult::Cancelled);
            };
            if ticket.claiming || ticket.nonce.is_empty() {
                return Ok(ClaimResult::Pending);
            }
            let secret: PendingSecret = self
                .read_secret(&format!("pending:{owner}"))
                .await?
                .ok_or("DESKTOP_AUTH_VAULT_INVALID")?;
            if secret.nonce != ticket.nonce {
                return Err("DESKTOP_AUTH_VAULT_INVALID".into());
            }
            ticket.claiming = true;
            json!({ "nonce": secret.nonce, "claimKey": secret.claim_key })
        };
        let result = async {
            let response = self.post("/desktop/api/claim", body).await?;
            match response.status() {
                StatusCode::ACCEPTED => Ok(None),
                StatusCode::GONE => Err("DESKTOP_AUTH_EXPIRED".into()),
                StatusCode::OK => TokenSession::new(read_json(response).await?).map(Some),
                _ => Err("DESKTOP_AUTH_CLAIM_FAILED".into()),
            }
        }
        .await;
        let mut stored_tokens = self.tokens.lock().await;
        let mut pending = self.pending.lock().await;
        let Some(ticket) = pending
            .get_mut(owner)
            .filter(|ticket| ticket.id == login_id)
        else {
            return Ok(ClaimResult::Cancelled);
        };
        ticket.claiming = false;
        match result {
            Ok(Some(tokens)) => {
                let session = tokens.public.clone();
                *stored_tokens = Some(tokens);
                pending.remove(owner);
                self.persist(
                    stored_tokens
                        .as_mut()
                        .ok_or("DESKTOP_AUTH_SESSION_MISSING")?,
                )
                .await?;
                self.invalidated.store(false, Ordering::Relaxed);
                self.vault
                    .access(format!("pending:{owner}"), VaultAction::Delete)
                    .await?;
                Ok(ClaimResult::Authenticated { session })
            }
            Ok(None) => Ok(ClaimResult::Pending),
            Err(error) => {
                pending.remove(owner);
                self.vault
                    .access(format!("pending:{owner}"), VaultAction::Delete)
                    .await?;
                if error == "DESKTOP_AUTH_EXPIRED" {
                    return Ok(ClaimResult::Expired);
                }
                Err(error)
            }
        }
    }

    async fn current(
        &self,
        rejected: Option<&str>,
    ) -> Result<Option<(AuthSession, String)>, String> {
        let mut tokens = self.tokens.lock().await;
        if tokens.is_none() && self.invalidated.load(Ordering::Relaxed) {
            return Ok(None);
        }
        if tokens.is_none() {
            if let Some(saved) = self.read_secret::<SavedTokens>("session").await? {
                *tokens = Some(TokenSession::restore(saved)?);
            }
        }
        let Some(stored) = tokens.as_mut() else {
            return Ok(None);
        };
        if stored.refresh_expires <= Instant::now() {
            self.invalidated.store(true, Ordering::Relaxed);
            *tokens = None;
            self.vault
                .access("session".into(), VaultAction::Delete)
                .await?;
            return Ok(None);
        }
        self.persist(stored).await?;
        let force = rejected.is_some_and(|token| token == stored.data.access_token);
        if force || stored.expires <= Instant::now() + Duration::from_secs(30) {
            let response = self
                .post(
                    "/desktop/api/refresh",
                    json!({ "refreshToken": stored.data.refresh_token }),
                )
                .await?;
            if response.status() == StatusCode::BAD_REQUEST {
                let error: Value = read_json(response).await?;
                if error.get("error").and_then(Value::as_str) == Some("invalid_grant") {
                    self.invalidated.store(true, Ordering::Relaxed);
                    *tokens = None;
                    self.vault
                        .access("session".into(), VaultAction::Delete)
                        .await?;
                    return Ok(None);
                }
            } else if response.status() == StatusCode::OK {
                *tokens = Some(TokenSession::new(read_json(response).await?)?);
                let stored = tokens.as_mut().ok_or("DESKTOP_AUTH_SESSION_MISSING")?;
                self.persist(stored).await?;
                return Ok(Some((
                    stored.public.clone(),
                    stored.data.access_token.clone(),
                )));
            }
            return Err("DESKTOP_AUTH_REFRESH_FAILED".into());
        }
        Ok(Some((
            stored.public.clone(),
            stored.data.access_token.clone(),
        )))
    }

    pub async fn session(&self) -> Result<Option<AuthSession>, String> {
        Ok(self.current(None).await?.map(|(session, _)| session))
    }

    pub async fn employee(&self) -> Result<EmployeeInfo, String> {
        let body = self.request("GET", "/api/employee/me", Value::Null).await?;
        let code = body
            .get("code")
            .and_then(Value::as_i64)
            .ok_or("DESKTOP_AUTH_RESPONSE_INVALID: /api/employee/me code must be an integer")?;
        if code != 0 {
            return Err(format!("DESKTOP_AUTH_EMPLOYEE_FAILED: code={code}"));
        }
        let employee: EmployeeInfo =
            serde_json::from_value(body.get("data").cloned().unwrap_or(Value::Null)).map_err(|_| {
                "DESKTOP_AUTH_RESPONSE_INVALID: /api/employee/me data must contain string employeeNumber and employeeName"
            })?;
        if employee.employee_number.trim().is_empty() {
            return Err(
                "DESKTOP_AUTH_RESPONSE_INVALID: /api/employee/me employeeNumber is blank".into(),
            );
        }
        if employee.employee_name.trim().is_empty() {
            return Err(
                "DESKTOP_AUTH_RESPONSE_INVALID: /api/employee/me employeeName is blank".into(),
            );
        }
        Ok(employee)
    }

    pub async fn access_token(&self) -> Result<String, String> {
        self.current(None)
            .await?
            .map(|(_, token)| token)
            .ok_or_else(|| "DESKTOP_AUTH_SESSION_MISSING".into())
    }

    pub async fn request(&self, method: &str, path: &str, body: Value) -> Result<Value, String> {
        let method = match method {
            "GET" => Method::GET,
            "POST" => Method::POST,
            "PUT" => Method::PUT,
            "PATCH" => Method::PATCH,
            "DELETE" => Method::DELETE,
            _ => return Err("DESKTOP_AUTH_REQUEST_INVALID".into()),
        };
        let url = self
            .endpoint()?
            .join(path)
            .map_err(|_| "DESKTOP_AUTH_REQUEST_INVALID")?;
        if !path.starts_with("/api/")
            || !url.path().starts_with("/api/")
            || url.origin() != self.endpoint()?.origin()
            || url.fragment().is_some()
        {
            return Err("DESKTOP_AUTH_REQUEST_INVALID".into());
        }
        let mut token = self.access_token().await?;
        let mut response = self.send(method.clone(), path, &body, Some(&token)).await?;
        if response.status() == StatusCode::UNAUTHORIZED {
            token = self
                .current(Some(&token))
                .await?
                .map(|(_, token)| token)
                .ok_or("DESKTOP_AUTH_SESSION_MISSING")?;
            response = self.send(method, path, &body, Some(&token)).await?;
            if response.status() == StatusCode::UNAUTHORIZED {
                let mut tokens = self.tokens.lock().await;
                if tokens
                    .as_ref()
                    .is_some_and(|current| current.data.access_token == token)
                {
                    self.invalidated.store(true, Ordering::Relaxed);
                    *tokens = None;
                    self.vault
                        .access("session".into(), VaultAction::Delete)
                        .await?;
                }
                return Err("DESKTOP_AUTH_SESSION_MISSING".into());
            }
        }
        if !response.status().is_success() {
            return Err(format!("DESKTOP_AUTH_HTTP_{}", response.status().as_u16()));
        }
        if response.status() == StatusCode::NO_CONTENT {
            return Ok(Value::Null);
        }
        read_json(response).await.map_err(|error| {
            if path == "/api/employee/me" && error == "DESKTOP_AUTH_RESPONSE_INVALID" {
                "DESKTOP_AUTH_RESPONSE_INVALID: GET /api/employee/me expected valid JSON within 64 KiB".into()
            } else {
                error
            }
        })
    }

    #[cfg(test)]
    pub(crate) fn for_test() -> Self {
        Self {
            vault: Arc::new(tests::MemoryVault::default()),
            ..Self::default()
        }
    }
}

fn now_ms() -> Result<u64, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "DESKTOP_AUTH_CLOCK_INVALID")?
        .as_millis() as u64)
}

impl TokenSession {
    fn new(data: TokenResponse) -> Result<Self, String> {
        if data.access_token.trim().is_empty()
            || data.refresh_token.trim().is_empty()
            || !data.token_type.eq_ignore_ascii_case("Bearer")
            || data.expires_in == 0
            || data.expires_in > 31_536_000
            || data.refresh_expires_in == 0
            || data.refresh_expires_in > 315_360_000
            || data.employee_number.trim().is_empty()
            || data.employee_name.trim().is_empty()
        {
            return Err("DESKTOP_AUTH_RESPONSE_INVALID".into());
        }
        let now = Instant::now();
        let wall_clock = now_ms()?;
        Ok(Self {
            expires: now + Duration::from_secs(data.expires_in),
            refresh_expires: now + Duration::from_secs(data.refresh_expires_in),
            refresh_expires_at: wall_clock + data.refresh_expires_in * 1000,
            public: AuthSession {
                employee_number: data.employee_number.clone(),
                employee_name: data.employee_name.clone(),
                expires_at: wall_clock + data.expires_in * 1000,
            },
            data,
            persisted: false,
        })
    }

    fn restore(saved: SavedTokens) -> Result<Self, String> {
        let mut session = Self::new(saved.data)?;
        let wall_clock = now_ms()?;
        let now = Instant::now();
        if saved.expires_at.saturating_sub(wall_clock) > session.data.expires_in * 1000
            || saved.refresh_expires_at.saturating_sub(wall_clock)
                > session.data.refresh_expires_in * 1000
        {
            return Err("DESKTOP_AUTH_VAULT_INVALID".into());
        }
        session.expires = now + Duration::from_millis(saved.expires_at.saturating_sub(wall_clock));
        session.refresh_expires =
            now + Duration::from_millis(saved.refresh_expires_at.saturating_sub(wall_clock));
        session.refresh_expires_at = saved.refresh_expires_at;
        session.public.expires_at = saved.expires_at;
        session.persisted = true;
        Ok(session)
    }
}

async fn read_json<T: DeserializeOwned>(mut response: Response) -> Result<T, String> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "DESKTOP_AUTH_NETWORK")? {
        if bytes.len() + chunk.len() > 65_536 {
            return Err("DESKTOP_AUTH_RESPONSE_INVALID".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "DESKTOP_AUTH_RESPONSE_INVALID".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
        sync::Notify,
        task::JoinHandle,
    };

    #[derive(Default)]
    pub(super) struct MemoryVault {
        values: Mutex<HashMap<String, Vec<u8>>>,
        fail_write: std::sync::atomic::AtomicBool,
        fail_read: std::sync::atomic::AtomicBool,
        fail_delete: std::sync::atomic::AtomicBool,
    }

    #[async_trait::async_trait]
    impl CredentialVault for MemoryVault {
        async fn access(
            &self,
            key: String,
            action: VaultAction,
        ) -> Result<Option<Vec<u8>>, String> {
            let mut values = self.values.lock().await;
            match action {
                VaultAction::Read => {
                    if self.fail_read.load(Ordering::Relaxed) {
                        return Err("DESKTOP_AUTH_VAULT_UNAVAILABLE".into());
                    }
                    Ok(values.get(&key).cloned())
                }
                VaultAction::Write(bytes) => {
                    if self.fail_write.load(Ordering::Relaxed) {
                        return Err("DESKTOP_AUTH_VAULT_UNAVAILABLE".into());
                    }
                    values.insert(key, bytes);
                    Ok(None)
                }
                VaultAction::Delete => {
                    if self.fail_delete.load(Ordering::Relaxed) {
                        return Err("DESKTOP_AUTH_VAULT_UNAVAILABLE".into());
                    }
                    values.remove(&key);
                    Ok(None)
                }
            }
        }
    }

    struct Backend {
        auth: Arc<AuthService>,
        requests: Arc<Mutex<Vec<(String, Value)>>>,
        headers: Arc<Mutex<Vec<String>>>,
        vault: Arc<MemoryVault>,
        task: JoinHandle<()>,
    }

    impl Drop for Backend {
        fn drop(&mut self) {
            self.task.abort();
        }
    }

    async fn backend(responses: Vec<(u16, Value)>, gate: Option<Arc<Notify>>) -> Backend {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let received = requests.clone();
        let headers = Arc::new(Mutex::new(Vec::new()));
        let captured_headers = headers.clone();
        let task = tokio::spawn(async move {
            for (status, body) in responses {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut bytes = Vec::new();
                let mut buffer = [0; 4096];
                let (head, payload) = loop {
                    let size = socket.read(&mut buffer).await.unwrap();
                    assert!(size > 0, "request ended before its body");
                    bytes.extend_from_slice(&buffer[..size]);
                    if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                        let head = String::from_utf8(bytes[..end].to_vec()).unwrap();
                        let length = head
                            .lines()
                            .find_map(|line| {
                                line.to_lowercase()
                                    .strip_prefix("content-length:")
                                    .map(|value| value.trim().parse::<usize>().unwrap())
                            })
                            .unwrap_or(0);
                        if bytes.len() >= end + 4 + length {
                            break (
                                head,
                                if length == 0 {
                                    Value::Null
                                } else {
                                    serde_json::from_slice(&bytes[end + 4..end + 4 + length])
                                        .unwrap()
                                },
                            );
                        }
                    }
                };
                if head.starts_with("POST /desktop/api/") {
                    assert!(!head.to_lowercase().contains("authorization:"));
                    assert!(head
                        .to_lowercase()
                        .contains("content-type: application/json"));
                }
                captured_headers.lock().await.push(head.clone());
                received
                    .lock()
                    .await
                    .push((head.lines().next().unwrap().into(), payload));
                if let Some(gate) = &gate {
                    gate.notified().await;
                }
                let body = body.to_string();
                socket.write_all(format!("HTTP/1.1 {status} Result\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
            }
        });
        let vault = Arc::new(MemoryVault::default());
        Backend {
            auth: Arc::new(AuthService {
                endpoint: Some(endpoint),
                vault: vault.clone(),
                ..AuthService::default()
            }),
            requests,
            headers,
            vault,
            task,
        }
    }

    fn ticket() -> Value {
        json!({"nonce":"nonce-one", "claimKey":"private-key", "loginPage":"https://service.test/desktop/login.html?nonce=nonce-one", "authUrl":"https://login.dingtalk.com/oauth2/auth?state=nonce-one"})
    }

    fn token(access: &str, refresh: &str) -> Value {
        json!({"access_token":access, "refresh_token":refresh, "token_type":"Bearer", "expires_in":7200, "refresh_expires_in":2592000, "scope":"mcp", "employee_number":"TD000001", "employee_name":"张三"})
    }

    #[tokio::test]
    async fn employee_uses_bearer_and_returns_only_enveloped_identity() {
        let server = backend(vec![(200, json!({"code":0,"msg":null,"data":{"employeeNumber":"TD000002","employeeName":"李四","email":"private@example.test"}}))], None).await;
        *server.auth.tokens.lock().await = Some(
            TokenSession::new(serde_json::from_value(token("access", "refresh")).unwrap()).unwrap(),
        );
        let employee = server.auth.employee().await.unwrap();
        assert_eq!(
            serde_json::to_value(employee).unwrap(),
            json!({"employeeNumber":"TD000002","employeeName":"李四"})
        );
        assert_eq!(
            *server.requests.lock().await,
            vec![("GET /api/employee/me HTTP/1.1".into(), Value::Null)]
        );
        assert!(server.headers.lock().await[0]
            .to_lowercase()
            .contains("authorization: bearer access"));
    }

    #[tokio::test]
    async fn employee_rejects_failed_or_malformed_envelopes() {
        for (body, error) in [
            (json!({"code":1,"msg":"denied","data":null}), "DESKTOP_AUTH_EMPLOYEE_FAILED: code=1"),
            (json!({"code":0,"data":null}), "DESKTOP_AUTH_RESPONSE_INVALID: /api/employee/me data must contain string employeeNumber and employeeName"),
            (json!({"code":0,"data":{"employeeNumber":"","employeeName":"张三"}}), "DESKTOP_AUTH_RESPONSE_INVALID: /api/employee/me employeeNumber is blank"),
            (json!({"code":0,"data":{"employeeNumber":"TD000001","employeeName":" "}}), "DESKTOP_AUTH_RESPONSE_INVALID: /api/employee/me employeeName is blank"),
            (json!({"code":0,"data":{"employeeNumber":123,"employeeName":"张三"}}), "DESKTOP_AUTH_RESPONSE_INVALID: /api/employee/me data must contain string employeeNumber and employeeName"),
            (json!({"code":0,"data":{"employeeNumber":"TD000001"}}), "DESKTOP_AUTH_RESPONSE_INVALID: /api/employee/me data must contain string employeeNumber and employeeName"),
            (json!({"employeeNumber":"TD000001","employeeName":"张三"}), "DESKTOP_AUTH_RESPONSE_INVALID: /api/employee/me code must be an integer"),
            (json!({"code":"0","data":{"employeeNumber":"TD000001","employeeName":"张三"}}), "DESKTOP_AUTH_RESPONSE_INVALID: /api/employee/me code must be an integer"),
        ] {
            let server = backend(vec![(200, body.clone())], None).await;
            *server.auth.tokens.lock().await = Some(
                TokenSession::new(serde_json::from_value(token("access", "refresh")).unwrap())
                    .unwrap(),
            );
            assert_eq!(server.auth.employee().await.err().unwrap(), error);
        }
    }

    #[tokio::test]
    async fn employee_non_json_response_identifies_the_failing_endpoint() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let auth = AuthService {
            endpoint: Some(format!("http://{}", listener.local_addr().unwrap())),
            ..AuthService::for_test()
        };
        *auth.tokens.lock().await = Some(
            TokenSession::new(serde_json::from_value(token("access", "refresh")).unwrap()).unwrap(),
        );
        let response = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0; 4096];
            socket.read(&mut request).await.unwrap();
            socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 13\r\nConnection: close\r\n\r\n<html></html>").await.unwrap();
        });
        assert_eq!(
            auth.employee().await.err().unwrap(),
            "DESKTOP_AUTH_RESPONSE_INVALID: GET /api/employee/me expected valid JSON within 64 KiB"
        );
        response.await.unwrap();
    }

    #[tokio::test]
    async fn employee_401_refreshes_rotated_tokens_before_retrying() {
        let server = backend(vec![(401,json!({})), (200,token("new-access","new-refresh")), (200,json!({"code":0,"msg":null,"data":{"employeeNumber":"TD000001","employeeName":"张三"}}))],None).await;
        *server.auth.tokens.lock().await = Some(
            TokenSession::new(serde_json::from_value(token("old-access", "old-refresh")).unwrap())
                .unwrap(),
        );
        assert_eq!(
            server.auth.employee().await.unwrap().employee_number,
            "TD000001"
        );
        let headers = server.headers.lock().await;
        assert!(headers[0]
            .to_lowercase()
            .contains("authorization: bearer old-access"));
        assert!(headers[2]
            .to_lowercase()
            .contains("authorization: bearer new-access"));
        let saved: SavedTokens = server.auth.read_secret("session").await.unwrap().unwrap();
        assert_eq!(saved.data.refresh_token, "new-refresh");
    }

    #[tokio::test]
    async fn employee_does_not_mislabel_a_refresh_response_error() {
        let server = backend(vec![(401, json!({})), (200, json!({}))], None).await;
        *server.auth.tokens.lock().await = Some(
            TokenSession::new(serde_json::from_value(token("access", "refresh")).unwrap()).unwrap(),
        );
        assert_eq!(
            server.auth.employee().await.err().unwrap(),
            "DESKTOP_AUTH_RESPONSE_INVALID"
        );
        assert_eq!(
            server.requests.lock().await[1].0,
            "POST /desktop/api/refresh HTTP/1.1"
        );
    }

    #[tokio::test]
    async fn logout_deletes_session_and_pending_keys_and_stays_signed_out_after_restart() {
        let server = backend(vec![(200, ticket()), (200, ticket())], None).await;
        *server.auth.tokens.lock().await = Some(
            TokenSession::new(serde_json::from_value(token("access", "refresh")).unwrap()).unwrap(),
        );
        server.auth.session().await.unwrap();
        server.auth.begin("main", "dingtalk").await.unwrap();
        server.auth.begin("window-1", "wecom").await.unwrap();
        assert_eq!(server.vault.values.lock().await.len(), 3);
        assert!(server.auth.logout().await.unwrap() > 0);
        assert!(server.auth.pending.lock().await.is_empty());
        assert!(server.vault.values.lock().await.is_empty());
        assert!(server.auth.session().await.unwrap().is_none());
        let restarted = AuthService {
            vault: server.vault.clone(),
            endpoint: server.auth.endpoint.clone(),
            ..AuthService::for_test()
        };
        assert!(restarted.session().await.unwrap().is_none());
    }

    #[tokio::test]
    async fn logout_vault_failure_blocks_old_session_and_can_be_retried() {
        let server = backend(vec![(200, ticket())], None).await;
        *server.auth.tokens.lock().await = Some(
            TokenSession::new(serde_json::from_value(token("access", "refresh")).unwrap()).unwrap(),
        );
        server.auth.session().await.unwrap();
        let ticket = server
            .auth
            .begin("main", "dingtalk")
            .await
            .unwrap()
            .unwrap();
        server.vault.fail_delete.store(true, Ordering::Relaxed);
        assert_eq!(
            server.auth.logout().await.unwrap_err(),
            "DESKTOP_AUTH_VAULT_UNAVAILABLE"
        );
        assert!(server.auth.session().await.unwrap().is_none());
        assert!(matches!(
            server.auth.claim("main", ticket.login_id).await.unwrap(),
            ClaimResult::Cancelled
        ));
        server.vault.fail_delete.store(false, Ordering::Relaxed);
        server.auth.logout().await.unwrap();
        assert!(server.vault.values.lock().await.is_empty());
    }

    #[tokio::test]
    async fn logout_discards_claim_success_that_arrives_late() {
        let gate = Arc::new(Notify::new());
        let server = backend(
            vec![(200, ticket()), (200, token("access", "refresh"))],
            Some(gate.clone()),
        )
        .await;
        gate.notify_one();
        let ticket = server
            .auth
            .begin("main", "dingtalk")
            .await
            .unwrap()
            .unwrap();
        let auth = server.auth.clone();
        let claim = tokio::spawn(async move { auth.claim("main", ticket.login_id).await });
        request_count(&server, 2).await;
        server.auth.logout().await.unwrap();
        gate.notify_one();
        assert!(matches!(
            claim.await.unwrap().unwrap(),
            ClaimResult::Cancelled
        ));
        assert!(server.auth.session().await.unwrap().is_none());
        assert!(server.vault.values.lock().await.is_empty());
    }

    async fn request_count(server: &Backend, count: usize) {
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                if server.requests.lock().await.len() == count {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn begin_returns_only_real_auth_url_and_local_identifier() {
        let server = backend(vec![(200, ticket())], None).await;
        let qr = server
            .auth
            .begin("main", "dingtalk")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            serde_json::to_value(qr).unwrap(),
            json!({"loginId":1,"authUrl":"https://login.dingtalk.com/oauth2/auth?state=nonce-one"})
        );
        assert_eq!(
            *server.requests.lock().await,
            vec![(
                "POST /desktop/api/begin HTTP/1.1".into(),
                json!({"platform":"dingtalk"})
            )]
        );
    }

    #[tokio::test]
    async fn begin_wecom_passes_platform_and_surfaces_backend_rejection() {
        let server = backend(
            vec![(
                400,
                json!({"error":"invalid_request","error_description":"企业微信登录未配置（hr.im.wecom），无法发起"}),
            )],
            None,
        )
        .await;
        assert_eq!(
            server.auth.begin("main", "wecom").await.err().unwrap(),
            "DESKTOP_AUTH_BEGIN_REJECTED: 企业微信登录未配置（hr.im.wecom），无法发起"
        );
        assert_eq!(
            *server.requests.lock().await,
            vec![(
                "POST /desktop/api/begin HTTP/1.1".into(),
                json!({"platform":"wecom"})
            )]
        );
        assert!(server.auth.pending.lock().await.is_empty());
    }

    #[tokio::test]
    async fn begin_rejects_unknown_platform_without_network() {
        let server = backend(Vec::new(), None).await;
        assert_eq!(
            server.auth.begin("main", "feishu").await.err().unwrap(),
            "DESKTOP_AUTH_REQUEST_INVALID"
        );
        assert!(server.requests.lock().await.is_empty());
    }

    #[tokio::test]
    async fn missing_auth_url_rejects_instead_of_encoding_login_page() {
        let mut response = ticket();
        response.as_object_mut().unwrap().remove("authUrl");
        let server = backend(vec![(200, response)], None).await;
        assert_eq!(
            server.auth.begin("main", "dingtalk").await.err().unwrap(),
            "DESKTOP_AUTH_AUTH_URL_MISSING"
        );
        assert!(server.auth.pending.lock().await.is_empty());
    }

    #[tokio::test]
    async fn pending_claim_keeps_polling_until_ticket_authenticates_employee() {
        let server = backend(
            vec![
                (200, ticket()),
                (202, json!({})),
                (200, token("access-one", "refresh-one")),
            ],
            None,
        )
        .await;
        let qr = server
            .auth
            .begin("main", "dingtalk")
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(
            server.auth.claim("main", qr.login_id).await.unwrap(),
            ClaimResult::Pending
        ));
        let result =
            serde_json::to_value(server.auth.claim("main", qr.login_id).await.unwrap()).unwrap();
        assert_eq!(result["status"], "authenticated");
        assert_eq!(result["session"]["employeeNumber"], "TD000001");
        assert_eq!(result["session"]["employeeName"], "张三");
        assert_eq!(result["session"].as_object().unwrap().len(), 3);
        assert_eq!(server.auth.access_token().await.unwrap(), "access-one");
        assert!(matches!(
            server.auth.claim("main", qr.login_id).await.unwrap(),
            ClaimResult::Cancelled
        ));
        let requests = server.requests.lock().await;
        assert_eq!(requests.len(), 3);
        assert_eq!(
            requests[1],
            (
                "POST /desktop/api/claim HTTP/1.1".into(),
                json!({"nonce":"nonce-one","claimKey":"private-key"})
            )
        );
    }

    #[tokio::test]
    async fn expired_claim_invalidates_ticket_without_authenticating() {
        let server = backend(vec![(200, ticket()), (410, json!({}))], None).await;
        let qr = server
            .auth
            .begin("main", "dingtalk")
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(
            server.auth.claim("main", qr.login_id).await.unwrap(),
            ClaimResult::Expired
        ));
        assert!(server.auth.session().await.unwrap().is_none());
        assert!(server.auth.pending.lock().await.is_empty());
    }

    #[tokio::test]
    async fn invalid_token_response_never_authenticates() {
        let mut invalid = token("access", "refresh");
        invalid["employee_number"] = json!("");
        let server = backend(vec![(200, ticket()), (200, invalid)], None).await;
        let qr = server
            .auth
            .begin("main", "dingtalk")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            server.auth.claim("main", qr.login_id).await.err().unwrap(),
            "DESKTOP_AUTH_RESPONSE_INVALID"
        );
        assert!(server.auth.session().await.unwrap().is_none());
    }

    #[tokio::test]
    async fn wrong_window_or_local_identifier_cannot_consume_ticket() {
        let server = backend(vec![(200, ticket())], None).await;
        let qr = server
            .auth
            .begin("main", "dingtalk")
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(
            server.auth.claim("other", qr.login_id).await.unwrap(),
            ClaimResult::Cancelled
        ));
        assert!(matches!(
            server.auth.claim("main", qr.login_id + 1).await.unwrap(),
            ClaimResult::Cancelled
        ));
        assert_eq!(server.requests.lock().await.len(), 1);
    }

    #[tokio::test]
    async fn cancelling_inflight_begin_discards_late_qr() {
        let gate = Arc::new(Notify::new());
        let server = backend(vec![(200, ticket())], Some(gate.clone())).await;
        let auth = server.auth.clone();
        let begin = tokio::spawn(async move { auth.begin("main", "dingtalk").await });
        request_count(&server, 1).await;
        server.auth.cancel("main").await.unwrap();
        gate.notify_one();
        assert!(begin.await.unwrap().unwrap().is_none());
        assert!(server.auth.pending.lock().await.is_empty());
    }

    #[tokio::test]
    async fn cancelled_claim_cannot_authenticate_when_response_arrives_late() {
        let gate = Arc::new(Notify::new());
        let server = backend(
            vec![(200, ticket()), (200, token("access", "refresh"))],
            Some(gate.clone()),
        )
        .await;
        gate.notify_one();
        let qr = server
            .auth
            .begin("main", "dingtalk")
            .await
            .unwrap()
            .unwrap();
        let auth = server.auth.clone();
        let claim = tokio::spawn(async move { auth.claim("main", qr.login_id).await });
        request_count(&server, 2).await;
        assert!(matches!(
            server.auth.claim("main", 1).await.unwrap(),
            ClaimResult::Pending
        ));
        server.auth.cancel("main").await.unwrap();
        gate.notify_one();
        assert!(matches!(
            claim.await.unwrap().unwrap(),
            ClaimResult::Cancelled
        ));
        assert!(server.auth.session().await.unwrap().is_none());
        assert_eq!(server.requests.lock().await.len(), 2);
    }

    async fn expire_access(server: &Backend) {
        server.auth.tokens.lock().await.as_mut().unwrap().expires = Instant::now();
    }

    #[tokio::test]
    async fn refresh_rotates_token_and_concurrent_access_refreshes_only_once() {
        let server = backend(
            vec![
                (200, ticket()),
                (200, token("access-one", "refresh-one")),
                (200, token("access-two", "refresh-two")),
                (200, token("access-three", "refresh-three")),
            ],
            None,
        )
        .await;
        let qr = server
            .auth
            .begin("main", "dingtalk")
            .await
            .unwrap()
            .unwrap();
        server.auth.claim("main", qr.login_id).await.unwrap();
        expire_access(&server).await;
        let (first, second) = tokio::join!(server.auth.access_token(), server.auth.access_token());
        assert_eq!(first.unwrap(), "access-two");
        assert_eq!(second.unwrap(), "access-two");
        expire_access(&server).await;
        assert_eq!(server.auth.access_token().await.unwrap(), "access-three");
        let requests = server.requests.lock().await;
        assert_eq!(requests.len(), 4);
        assert_eq!(
            requests[2],
            (
                "POST /desktop/api/refresh HTTP/1.1".into(),
                json!({"refreshToken":"refresh-one"})
            )
        );
        assert_eq!(requests[3].1, json!({"refreshToken":"refresh-two"}));
    }

    #[tokio::test]
    async fn invalid_grant_clears_session_and_requires_new_scan() {
        let server = backend(
            vec![
                (200, ticket()),
                (200, token("access", "refresh")),
                (400, json!({"error":"invalid_grant"})),
            ],
            None,
        )
        .await;
        let qr = server
            .auth
            .begin("main", "dingtalk")
            .await
            .unwrap()
            .unwrap();
        server.auth.claim("main", qr.login_id).await.unwrap();
        expire_access(&server).await;
        assert_eq!(
            server.auth.access_token().await.unwrap_err(),
            "DESKTOP_AUTH_SESSION_MISSING"
        );
        assert!(server.auth.session().await.unwrap().is_none());
    }

    #[tokio::test]
    async fn refresh_server_failure_preserves_refresh_token_for_retry() {
        let server = backend(
            vec![
                (200, ticket()),
                (200, token("access", "refresh")),
                (503, json!({})),
                (200, token("new-access", "new-refresh")),
            ],
            None,
        )
        .await;
        let qr = server
            .auth
            .begin("main", "dingtalk")
            .await
            .unwrap()
            .unwrap();
        server.auth.claim("main", qr.login_id).await.unwrap();
        expire_access(&server).await;
        assert_eq!(
            server.auth.access_token().await.unwrap_err(),
            "DESKTOP_AUTH_REFRESH_FAILED"
        );
        assert_eq!(server.auth.access_token().await.unwrap(), "new-access");
        assert_eq!(
            server.requests.lock().await[3].1,
            json!({"refreshToken":"refresh"})
        );
    }
    async fn authenticated(server: &Backend) {
        let qr = server
            .auth
            .begin("main", "dingtalk")
            .await
            .unwrap()
            .unwrap();
        server.auth.claim("main", qr.login_id).await.unwrap();
    }

    fn restarted(server: &Backend) -> AuthService {
        AuthService {
            endpoint: server.auth.endpoint.clone(),
            vault: server.vault.clone(),
            ..AuthService::default()
        }
    }

    #[tokio::test]
    async fn claim_key_is_in_vault_and_is_removed_after_success() {
        let server = backend(
            vec![(200, ticket()), (200, token("access", "refresh"))],
            None,
        )
        .await;
        let qr = server
            .auth
            .begin("main", "dingtalk")
            .await
            .unwrap()
            .unwrap();
        let pending: PendingSecret = server
            .auth
            .read_secret("pending:main")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(pending.claim_key, "private-key");
        server.auth.claim("main", qr.login_id).await.unwrap();
        assert!(!server
            .vault
            .values
            .lock()
            .await
            .contains_key("pending:main"));
        let saved: SavedTokens = server.auth.read_secret("session").await.unwrap().unwrap();
        assert_eq!(saved.data.refresh_token, "refresh");
    }

    #[tokio::test]
    async fn startup_restores_session_without_new_scan_or_extending_expiry() {
        let server = backend(
            vec![(200, ticket()), (200, token("access", "refresh"))],
            None,
        )
        .await;
        authenticated(&server).await;
        let expires_at = server.auth.session().await.unwrap().unwrap().expires_at;
        let restored = restarted(&server);
        let session = restored.session().await.unwrap().unwrap();
        assert_eq!(session.employee_number, "TD000001");
        assert_eq!(session.expires_at, expires_at);
        assert_eq!(restored.access_token().await.unwrap(), "access");
        assert_eq!(server.requests.lock().await.len(), 2);
    }

    #[tokio::test]
    async fn startup_refreshes_expired_access_and_persists_rotated_refresh_token() {
        let server = backend(
            vec![
                (200, ticket()),
                (200, token("access-one", "refresh-one")),
                (200, token("access-two", "refresh-two")),
            ],
            None,
        )
        .await;
        authenticated(&server).await;
        let mut saved: SavedTokens = server.auth.read_secret("session").await.unwrap().unwrap();
        saved.expires_at = now_ms().unwrap() - 1;
        server.auth.save_secret("session", &saved).await.unwrap();
        let restored = restarted(&server);
        assert_eq!(
            restored.session().await.unwrap().unwrap().employee_name,
            "张三"
        );
        assert_eq!(restored.access_token().await.unwrap(), "access-two");
        let saved: SavedTokens = restored.read_secret("session").await.unwrap().unwrap();
        assert_eq!(saved.data.refresh_token, "refresh-two");
        assert_eq!(
            server.requests.lock().await[2].1,
            json!({"refreshToken":"refresh-one"})
        );
    }

    #[tokio::test]
    async fn keychain_failure_never_falls_back_to_plaintext_or_succeeds_silently() {
        let server = backend(vec![(200, ticket())], None).await;
        server.vault.fail_write.store(true, Ordering::Relaxed);
        assert_eq!(
            server.auth.begin("main", "dingtalk").await.err().unwrap(),
            "DESKTOP_AUTH_VAULT_UNAVAILABLE"
        );
        assert!(server.auth.pending.lock().await.is_empty());
        assert!(server.vault.values.lock().await.is_empty());
        server.vault.fail_read.store(true, Ordering::Relaxed);
        assert_eq!(
            server.auth.session().await.err().unwrap(),
            "DESKTOP_AUTH_VAULT_UNAVAILABLE"
        );
    }

    #[tokio::test]
    async fn rotation_write_failure_keeps_new_token_in_memory_for_save_retry() {
        let server = backend(
            vec![
                (200, ticket()),
                (200, token("access-one", "refresh-one")),
                (200, token("access-two", "refresh-two")),
            ],
            None,
        )
        .await;
        authenticated(&server).await;
        expire_access(&server).await;
        server.vault.fail_write.store(true, Ordering::Relaxed);
        assert_eq!(
            server.auth.access_token().await.unwrap_err(),
            "DESKTOP_AUTH_VAULT_UNAVAILABLE"
        );
        server.vault.fail_write.store(false, Ordering::Relaxed);
        assert_eq!(server.auth.access_token().await.unwrap(), "access-two");
        let saved: SavedTokens = server.auth.read_secret("session").await.unwrap().unwrap();
        assert_eq!(saved.data.refresh_token, "refresh-two");
        assert_eq!(server.requests.lock().await.len(), 3);
    }

    #[tokio::test]
    async fn expired_refresh_token_is_deleted_instead_of_restored_after_restart() {
        let server = backend(
            vec![(200, ticket()), (200, token("access", "refresh"))],
            None,
        )
        .await;
        authenticated(&server).await;
        let mut saved: SavedTokens = server.auth.read_secret("session").await.unwrap().unwrap();
        saved.refresh_expires_at = now_ms().unwrap() - 1;
        server.auth.save_secret("session", &saved).await.unwrap();
        assert!(restarted(&server).session().await.unwrap().is_none());
        assert!(!server.vault.values.lock().await.contains_key("session"));
        assert_eq!(server.requests.lock().await.len(), 2);
    }

    #[tokio::test]
    async fn business_401_refreshes_once_and_retries_with_new_bearer_token() {
        let server = backend(
            vec![
                (200, ticket()),
                (200, token("access-one", "refresh-one")),
                (401, json!({})),
                (200, token("access-two", "refresh-two")),
                (200, json!({"result":"ok"})),
            ],
            None,
        )
        .await;
        authenticated(&server).await;
        assert_eq!(
            server
                .auth
                .request("GET", "/api/private", Value::Null)
                .await
                .unwrap(),
            json!({"result":"ok"})
        );
        let requests = server.requests.lock().await;
        assert_eq!(requests[2].0, "GET /api/private HTTP/1.1");
        assert_eq!(
            requests[3],
            (
                "POST /desktop/api/refresh HTTP/1.1".into(),
                json!({"refreshToken":"refresh-one"})
            )
        );
        assert_eq!(requests[4].0, "GET /api/private HTTP/1.1");
        let headers = server.headers.lock().await;
        assert!(headers[2]
            .to_lowercase()
            .contains("authorization: bearer access-one"));
        assert!(headers[4]
            .to_lowercase()
            .contains("authorization: bearer access-two"));
        let saved: SavedTokens = server.auth.read_secret("session").await.unwrap().unwrap();
        assert_eq!(saved.data.refresh_token, "refresh-two");
    }

    #[tokio::test]
    async fn second_401_clears_credentials_without_an_infinite_retry() {
        let server = backend(
            vec![
                (200, ticket()),
                (200, token("access-one", "refresh-one")),
                (401, json!({})),
                (200, token("access-two", "refresh-two")),
                (401, json!({})),
            ],
            None,
        )
        .await;
        authenticated(&server).await;
        assert_eq!(
            server
                .auth
                .request("GET", "/api/private", Value::Null)
                .await
                .unwrap_err(),
            "DESKTOP_AUTH_SESSION_MISSING"
        );
        assert!(server.auth.session().await.unwrap().is_none());
        assert!(!server.vault.values.lock().await.contains_key("session"));
        assert_eq!(server.requests.lock().await.len(), 5);
    }

    #[tokio::test]
    async fn business_requests_reject_external_or_normalized_non_api_paths_before_network() {
        let auth = AuthService::for_test();
        for path in [
            "https://example.com/api/private",
            "//example.com/api/private",
            "/api/../desktop/api/refresh",
            "/api/private#fragment",
        ] {
            assert_eq!(
                auth.request("GET", path, Value::Null).await.unwrap_err(),
                "DESKTOP_AUTH_REQUEST_INVALID"
            );
        }
        assert_eq!(
            auth.request("TRACE", "/api/private", Value::Null)
                .await
                .unwrap_err(),
            "DESKTOP_AUTH_REQUEST_INVALID"
        );
    }
    #[tokio::test]
    async fn concurrent_401_for_the_same_access_token_rotate_refresh_only_once() {
        let server = backend(
            vec![
                (200, ticket()),
                (200, token("access-one", "refresh-one")),
                (200, token("access-two", "refresh-two")),
            ],
            None,
        )
        .await;
        authenticated(&server).await;
        let (first, second) = tokio::join!(
            server.auth.current(Some("access-one")),
            server.auth.current(Some("access-one"))
        );
        assert_eq!(first.unwrap().unwrap().1, "access-two");
        assert_eq!(second.unwrap().unwrap().1, "access-two");
        assert_eq!(server.requests.lock().await.len(), 3);
        let saved: SavedTokens = server.auth.read_secret("session").await.unwrap().unwrap();
        assert_eq!(saved.data.refresh_token, "refresh-two");
    }

    #[tokio::test]
    async fn business_403_does_not_consume_a_refresh_token() {
        let server = backend(
            vec![
                (200, ticket()),
                (200, token("access", "refresh")),
                (403, json!({"error":"forbidden"})),
            ],
            None,
        )
        .await;
        authenticated(&server).await;
        assert_eq!(
            server
                .auth
                .request("GET", "/api/private", Value::Null)
                .await
                .unwrap_err(),
            "DESKTOP_AUTH_HTTP_403"
        );
        assert_eq!(server.auth.access_token().await.unwrap(), "access");
        assert_eq!(server.requests.lock().await.len(), 3);
    }

    #[tokio::test]
    async fn corrupted_persisted_expiry_is_rejected_without_panicking() {
        let server = backend(
            vec![(200, ticket()), (200, token("access", "refresh"))],
            None,
        )
        .await;
        authenticated(&server).await;
        let mut saved: SavedTokens = server.auth.read_secret("session").await.unwrap().unwrap();
        saved.expires_at = u64::MAX;
        server.auth.save_secret("session", &saved).await.unwrap();
        assert_eq!(
            restarted(&server).session().await.err().unwrap(),
            "DESKTOP_AUTH_VAULT_INVALID"
        );
    }
    #[tokio::test]
    async fn revoked_session_is_not_restored_when_vault_deletion_is_denied() {
        let server = backend(
            vec![
                (200, ticket()),
                (200, token("access", "refresh")),
                (400, json!({"error":"invalid_grant"})),
            ],
            None,
        )
        .await;
        authenticated(&server).await;
        server.vault.fail_delete.store(true, Ordering::Relaxed);
        assert_eq!(
            server.auth.current(Some("access")).await.err().unwrap(),
            "DESKTOP_AUTH_VAULT_UNAVAILABLE"
        );
        assert!(server.auth.session().await.unwrap().is_none());
        assert_eq!(
            server.auth.access_token().await.unwrap_err(),
            "DESKTOP_AUTH_SESSION_MISSING"
        );
        assert_eq!(server.requests.lock().await.len(), 3);
    }
}
