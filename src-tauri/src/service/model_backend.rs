use axum::{
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde_json::Value;
use std::{future::Future, net::SocketAddr};
use tokio::{net::TcpListener, task::JoinHandle};

pub(super) struct ModelBackendProxy {
    pub backend: String,
    pub url: String,
    task: JoinHandle<()>,
}

impl ModelBackendProxy {
    pub async fn start<F, Fut>(backend: String, request: F) -> Result<Self, String>
    where
        F: Fn() -> Fut + Clone + Send + Sync + 'static,
        Fut: Future<Output = Result<Value, String>> + Send + 'static,
    {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|_| "MODEL_BACKEND_PROXY_BIND_FAILED")?;
        let address = listener
            .local_addr()
            .map_err(|_| "MODEL_BACKEND_PROXY_BIND_FAILED")?;
        let mut secret = [0u8; 32];
        getrandom::fill(&mut secret).map_err(|_| "MODEL_BACKEND_PROXY_RANDOM_FAILED")?;
        let secret: String = secret.iter().map(|byte| format!("{byte:02x}")).collect();
        let path = format!("/{secret}/api/model-provider/config");
        let upstream = backend.clone();
        let router = Router::new().route(
            &path,
            get(move |headers: HeaderMap| {
                let request = request.clone();
                let upstream = upstream.clone();
                async move {
                    if !allows_request(&headers, address) {
                        return StatusCode::FORBIDDEN.into_response();
                    }
                    let response = match request().await {
                        Ok(mut body) => {
                            restore_base_urls(&mut body, &upstream);
                            Json(body).into_response()
                        }
                        Err(error) => error_status(&error).into_response(),
                    };
                    no_store(response)
                }
            }),
        );
        let task = tokio::spawn(async move {
            if let Err(error) = axum::serve(listener, router).await {
                log::warn!("MODEL_BACKEND_PROXY_STOPPED: {error}");
            }
        });
        Ok(Self {
            backend,
            url: format!("http://{address}/{secret}"),
            task,
        })
    }
}

impl Drop for ModelBackendProxy {
    fn drop(&mut self) {
        self.task.abort();
    }
}

fn allows_request(headers: &HeaderMap, address: SocketAddr) -> bool {
    !headers.contains_key(header::ORIGIN)
        && headers
            .get(header::HOST)
            .and_then(|host| host.to_str().ok())
            == Some(address.to_string().as_str())
}

fn no_store(mut response: Response) -> Response {
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static("no-store"),
    );
    response
}

fn error_status(error: &str) -> StatusCode {
    match error {
        "DESKTOP_AUTH_SESSION_MISSING" => StatusCode::UNAUTHORIZED,
        "DESKTOP_AUTH_HTTP_403" => StatusCode::FORBIDDEN,
        _ => StatusCode::BAD_GATEWAY,
    }
}

fn restore_base_urls(body: &mut Value, backend: &str) {
    if let Some(entries) = body.as_array_mut() {
        for entry in entries {
            restore_base_urls(entry, backend);
        }
        return;
    }
    let Some(object) = body.as_object_mut() else {
        return;
    };
    if object
        .get("data")
        .and_then(Value::as_array)
        .is_some_and(|data| {
            data.iter().any(|entry| {
                entry.get("models").is_some()
                    || entry.get("data").is_some_and(Value::is_array)
                    || entry.get("route").is_some()
                    || entry.get("baseURL").is_some()
            })
        })
    {
        restore_base_urls(object.get_mut("data").unwrap(), backend);
        return;
    }
    if object.contains_key("models") || object.contains_key("data") {
        let has_base = ["baseURL", "baseUrl"].iter().any(|key| {
            object
                .get(*key)
                .and_then(Value::as_str)
                .is_some_and(|value| !value.trim().is_empty())
        });
        if !has_base {
            object.insert("baseURL".into(), format!("{backend}/api/v1").into());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn preserves_declared_model_endpoints() {
        let mut body = json!({"code":0,"data":[
            {"models":[{"id":"model-a"}],"baseURL":"https://llm.example/v1"},
            {"models":[{"id":"model-b"}],"baseUrl":"https://other.example/v1"}
        ]});
        let expected = body.clone();
        restore_base_urls(&mut body, "https://backend.example");
        assert_eq!(body, expected);
    }

    #[test]
    fn defaults_gateway_endpoints_to_the_upstream_instead_of_the_local_proxy() {
        for mut body in [
            json!([{"models":[{"id":"model-a"}]}]),
            json!({"code":0,"data":[{"models":[{"id":"model-a"}]}]}),
        ] {
            restore_base_urls(&mut body, "https://backend.example");
            let grant = if body.is_array() {
                &body[0]
            } else {
                &body["data"][0]
            };
            assert_eq!(
                grant,
                &json!({
                    "models":[{"id":"model-a"}],
                    "baseURL":"https://backend.example/api/v1"
                })
            );
        }
    }

    #[test]
    fn defaults_nested_gateway_endpoints_to_the_upstream() {
        let mut body = json!({"code":0,"data":[{"data":[{"id":"model-a"}]}]});
        restore_base_urls(&mut body, "https://backend.example");
        assert_eq!(
            body,
            json!({"code":0,"data":[{
                "data":[{"id":"model-a"}],
                "baseURL":"https://backend.example/api/v1"
            }]})
        );
    }

    #[test]
    fn preserves_a_bare_model_list_without_changing_model_entries() {
        let mut body = json!({"data":[{"id":"model-a","name":"Model A"}]});
        restore_base_urls(&mut body, "https://backend.example");
        assert_eq!(
            body,
            json!({
                "data":[{"id":"model-a","name":"Model A"}],
                "baseURL":"https://backend.example/api/v1"
            })
        );
    }
}
