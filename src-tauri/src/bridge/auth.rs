use crate::service::auth::{AuthService, AuthSession, ClaimResult, EmployeeInfo, LoginQr};
use std::sync::Arc;
use tauri::Emitter;

#[tauri::command]
pub async fn desktop_auth_employee(
    auth: tauri::State<'_, Arc<AuthService>>,
) -> Result<EmployeeInfo, String> {
    auth.employee().await
}

#[tauri::command]
pub async fn desktop_auth_logout(
    app: tauri::AppHandle,
    auth: tauri::State<'_, Arc<AuthService>>,
) -> Result<u64, String> {
    let id = auth.logout().await?;
    app.emit("desktop-auth-logged-out", id)
        .map_err(|_| "DESKTOP_AUTH_EVENT_FAILED")?;
    Ok(id)
}

#[tauri::command]
pub async fn desktop_auth_begin(
    window: tauri::WebviewWindow,
    auth: tauri::State<'_, Arc<AuthService>>,
    platform: String,
) -> Result<Option<LoginQr>, String> {
    auth.begin(window.label(), &platform).await
}

#[tauri::command]
pub async fn desktop_auth_claim(
    window: tauri::WebviewWindow,
    auth: tauri::State<'_, Arc<AuthService>>,
    login_id: u64,
) -> Result<ClaimResult, String> {
    auth.claim(window.label(), login_id).await
}

#[tauri::command]
pub async fn desktop_auth_cancel(
    window: tauri::WebviewWindow,
    auth: tauri::State<'_, Arc<AuthService>>,
) -> Result<(), String> {
    auth.cancel(window.label()).await
}

#[tauri::command]
pub async fn desktop_auth_session(
    auth: tauri::State<'_, Arc<AuthService>>,
) -> Result<Option<AuthSession>, String> {
    auth.session().await
}

#[tauri::command]
pub async fn desktop_auth_access_token(
    auth: tauri::State<'_, Arc<AuthService>>,
) -> Result<String, String> {
    auth.access_token().await
}

#[tauri::command]
pub fn desktop_auth_api_base(auth: tauri::State<'_, Arc<AuthService>>) -> Result<String, String> {
    auth.api_base()
}

#[tauri::command]
pub async fn desktop_auth_request(
    auth: tauri::State<'_, Arc<AuthService>>,
    method: String,
    path: String,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    auth.request(&method, &path, body).await
}

#[tauri::command]
pub async fn desktop_auth_upload(
    auth: tauri::State<'_, Arc<AuthService>>,
    path: String,
    file_name: String,
    content_type: String,
    body: Vec<u8>,
) -> Result<serde_json::Value, String> {
    auth.upload(&path, &file_name, &content_type, body).await
}

#[tauri::command]
pub async fn desktop_install_employee_skill<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    auth: tauri::State<'_, Arc<AuthService>>,
    skill_name: String,
) -> Result<(), String> {
    auth.access_token().await?;
    let home = crate::config::get_dsh_data_path(&app);
    crate::service::skill::ensure_available(&home, &skill_name)?;
    let download = auth.download_skill(&skill_name, None).await?;
    tokio::task::spawn_blocking(move || {
        crate::service::skill::install(
            &home,
            &skill_name,
            &download.bytes,
            download.version.as_deref(),
        )
    })
    .await
    .map_err(|error| format!("SKILL_INSTALL_FAILED: {error}"))?
}

#[tauri::command]
pub async fn desktop_update_employee_skill<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    auth: tauri::State<'_, Arc<AuthService>>,
    skill_name: String,
    expected_version: String,
    installed_version: Option<String>,
) -> Result<String, String> {
    let home = crate::config::get_dsh_data_path(&app);
    crate::service::skill::download_update(
        &**auth,
        home,
        skill_name,
        expected_version,
        installed_version,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};

    #[test]
    fn remote_iframe_cannot_reach_token_command_but_local_shell_can() {
        let reached = Arc::new(AtomicBool::new(false));
        let dispatched = reached.clone();
        let handler: fn(tauri::ipc::Invoke<tauri::test::MockRuntime>) -> bool = tauri::generate_handler![
            desktop_auth_access_token,
            desktop_auth_request,
            desktop_auth_upload,
            desktop_install_employee_skill,
            desktop_update_employee_skill,
            desktop_auth_employee
        ];
        let app = mock_builder()
            .manage(Arc::new(AuthService::for_test()))
            .invoke_handler(move |invoke| {
                dispatched.store(true, Ordering::Relaxed);
                handler(invoke)
            })
            .build(mock_context(noop_assets()))
            .unwrap();
        let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        for command in [
            "desktop_auth_access_token",
            "desktop_auth_request",
            "desktop_auth_upload",
            "desktop_install_employee_skill",
            "desktop_update_employee_skill",
            "desktop_auth_employee",
        ] {
            for (origin, allowed) in [
                ("http://127.0.0.1:3081", false),
                ("tauri://localhost", true),
            ] {
                reached.store(false, Ordering::Relaxed);
                let body = if command == "desktop_auth_upload" {
                    serde_json::json!({
                        "path": "/api/employee-skills/upload",
                        "fileName": "demo.zip",
                        "contentType": "application/zip",
                        "body": [1, 2, 3]
                    })
                } else if command == "desktop_install_employee_skill" {
                    serde_json::json!({"skillName":"demo"})
                } else if command == "desktop_update_employee_skill" {
                    serde_json::json!({"skillName":"demo","expectedVersion":"1.1.0","installedVersion":"1.0.0"})
                } else {
                    serde_json::json!({"method":"GET","path":"/api/private","body":null})
                };
                let origin = if allowed && cfg!(any(windows, target_os = "android")) {
                    "http://tauri.localhost"
                } else {
                    origin
                };
                let error = get_ipc_response(
                    &window,
                    tauri::webview::InvokeRequest {
                        cmd: command.into(),
                        callback: tauri::ipc::CallbackFn(0),
                        error: tauri::ipc::CallbackFn(1),
                        url: origin.parse().unwrap(),
                        body: tauri::ipc::InvokeBody::Json(body),
                        headers: Default::default(),
                        invoke_key: INVOKE_KEY.into(),
                    },
                )
                .err()
                .unwrap();
                assert_eq!(reached.load(Ordering::Relaxed), allowed);
                if allowed {
                    assert_eq!(error, "DESKTOP_AUTH_SESSION_MISSING");
                } else {
                    assert!(error.as_str().unwrap().contains("not allowed"));
                }
            }
        }
    }
}
