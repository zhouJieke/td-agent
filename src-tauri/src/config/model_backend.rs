use std::collections::HashMap;

use reqwest::Url;

/// 模型后台域名：允许带路径前缀，但不接受查询、片段与非 HTTP 协议。
pub fn normalize_model_backend_url(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(String::new());
    }
    let invalid = || "MODEL_BACKEND_INVALID: use an HTTP or HTTPS model backend URL".to_string();
    if !value.contains("://") || value.chars().any(char::is_whitespace) {
        return Err(invalid());
    }
    let url = Url::parse(value).map_err(|_| invalid())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || url.port() == Some(0)
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(invalid());
    }
    let mut normalized = url.to_string();
    while normalized.ends_with('/') {
        normalized.pop();
    }
    Ok(normalized)
}

/// 交给核心子进程的后台域名；插件宿主据此拼 `/api/...` 接口。
pub fn model_backend_child_env(value: &str) -> HashMap<String, String> {
    let Ok(url) = normalize_model_backend_url(value) else {
        return HashMap::new();
    };
    if url.is_empty() {
        return HashMap::new();
    }
    HashMap::from([("DSH_MODEL_BACKEND_URL".to_string(), url)])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_backend_urls_to_origin_and_path_prefix() {
        assert_eq!(
            normalize_model_backend_url(" https://gw.example.com/base/ ").unwrap(),
            "https://gw.example.com/base"
        );
        assert_eq!(
            normalize_model_backend_url("http://127.0.0.1:8080").unwrap(),
            "http://127.0.0.1:8080"
        );
        assert_eq!(normalize_model_backend_url("  ").unwrap(), "");
    }

    #[test]
    fn rejects_non_http_or_ambiguous_backend_urls() {
        for value in [
            "gw.example.com",
            "ftp://gw.example.com",
            "https://gw.example.com?a=1",
            "https://gw.example.com#frag",
            "https://gw.example.com/a b",
            "https://gw.example.com:0",
        ] {
            let error = normalize_model_backend_url(value).unwrap_err();
            assert!(error.starts_with("MODEL_BACKEND_INVALID"), "{value}: {error}");
        }
    }

    #[test]
    fn exports_the_backend_env_entry_only_for_usable_urls() {
        assert!(model_backend_child_env("").is_empty());
        assert!(model_backend_child_env("not a url").is_empty());
        let envs = model_backend_child_env("https://gw.example.com/");
        assert_eq!(envs.len(), 1);
        assert_eq!(
            envs.get("DSH_MODEL_BACKEND_URL").map(String::as_str),
            Some("https://gw.example.com")
        );
    }
}
