use serde::Deserialize;
use std::time::Duration;
use tauri::AppHandle;

use super::{InstallKind, LatestDshPkg};
use crate::config;

#[derive(Debug, Deserialize)]
pub(crate) struct RuntimeAsset {
    version: String,
    pub url: String,
    pub sha256: String,
}

#[derive(Debug, Deserialize)]
struct DshAsset {
    #[serde(flatten)]
    asset: RuntimeAsset,
    tag: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeManifest {
    schema_version: u32,
    platform: String,
    arch: String,
    node: RuntimeAsset,
    pnpm: RuntimeAsset,
    dsh: DshAsset,
    git: Option<RuntimeAsset>,
}

impl RuntimeManifest {
    pub(crate) fn dsh_package(&self) -> LatestDshPkg {
        LatestDshPkg {
            tag: self.dsh.tag.clone(),
            commit: super::github::commit_fallback_from_tag(&self.dsh.tag),
            asset_url: self.dsh.asset.url.clone(),
            digest: Some(self.dsh.asset.sha256.clone()),
        }
    }

    pub(crate) fn asset(
        &self,
        kind: InstallKind,
        dsh: Option<&LatestDshPkg>,
    ) -> Option<&RuntimeAsset> {
        match kind {
            InstallKind::Node => Some(&self.node),
            InstallKind::Pnpm => Some(&self.pnpm),
            InstallKind::Git if self.platform == "windows" => self.git.as_ref(),
            InstallKind::Dsh if dsh.is_some_and(|info| info.tag == self.dsh.tag) => {
                Some(&self.dsh.asset)
            }
            _ => None,
        }
    }

    fn validate(self, platform: &str, arch: &str) -> Result<Self, String> {
        if self.schema_version != 1 || self.platform != platform || self.arch != arch {
            return Err("RUNTIME_MANIFEST_INVALID: unsupported schema or platform".into());
        }
        let runtime_arch = match (platform, arch) {
            ("macos" | "windows", "arm64") => "aarch64",
            ("macos" | "windows", "x64") => "x86_64",
            _ => {
                return Err("RUNTIME_MANIFEST_INVALID: unsupported platform or architecture".into())
            }
        };
        let node_version = config::NODE_VERSION.trim_start_matches('v');
        if self.node.version != node_version || self.pnpm.version != config::PNPM_VERSION {
            return Err("RUNTIME_MANIFEST_INVALID: Node.js or pnpm version mismatch".into());
        }
        if semver::Version::parse(&self.dsh.asset.version).is_err()
            || super::parse_version_from_tag(&self.dsh.tag).as_deref()
                != Some(self.dsh.asset.version.as_str())
        {
            return Err("RUNTIME_MANIFEST_INVALID: dsh tag and version mismatch".into());
        }
        let mut assets = vec![
            (
                &self.node,
                format!(
                    "node/{node_version}/{}",
                    config::node_pkg_filename(platform, runtime_arch)?
                ),
            ),
            (
                &self.pnpm,
                format!("pnpm/{0}/pnpm-{0}.tgz", self.pnpm.version),
            ),
            (
                &self.dsh.asset,
                format!(
                    "dsh/{}/{}",
                    self.dsh.tag,
                    config::dsh_pkg_asset_filename(platform, runtime_arch)?
                ),
            ),
        ];
        if platform == "windows" {
            let git = self
                .git
                .as_ref()
                .ok_or("RUNTIME_MANIFEST_INVALID: missing Git asset")?;
            let expected_sha = if arch == "arm64" {
                config::MINGIT_ARM64_SHA256
            } else {
                config::MINGIT_X64_SHA256
            };
            if git.version != config::MINGIT_VERSION
                || !git.sha256.eq_ignore_ascii_case(expected_sha)
            {
                return Err("RUNTIME_MANIFEST_INVALID: Git version or SHA-256 mismatch".into());
            }
            assets.push((
                git,
                format!(
                    "git/{}/{}",
                    config::MINGIT_VERSION,
                    config::mingit_pkg_filename(runtime_arch)?
                ),
            ));
        }
        for (asset, path) in assets {
            if asset.url != format!("{}/runtime/{path}", config::RUNTIME_DOWNLOAD_BASE_URL)
                || asset.sha256.len() != 64
                || !asset.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
            {
                return Err("RUNTIME_MANIFEST_INVALID: asset URL or SHA-256 is invalid".into());
            }
        }
        if !self.pnpm.sha256.eq_ignore_ascii_case(config::PNPM_SHA256) {
            return Err("RUNTIME_MANIFEST_INVALID: pnpm SHA-256 mismatch".into());
        }
        Ok(self)
    }
}

fn manifest_target(
    os: &str,
    host_arch: &str,
    dsh_url: &str,
) -> Option<(&'static str, &'static str)> {
    match (os, host_arch, dsh_url.rsplit('/').next()?) {
        ("macos", _, "deepseek-harness-pkg-macos-arm64.zip") => Some(("macos", "arm64")),
        ("macos", _, "deepseek-harness-pkg-macos-x64.zip") => Some(("macos", "x64")),
        ("windows", "x86_64" | "x64", "deepseek-harness-pkg-windows.zip") => {
            Some(("windows", "x64"))
        }
        ("windows", "aarch64" | "arm64", "deepseek-harness-pkg-windows.zip") => {
            Some(("windows", "arm64"))
        }
        _ => None,
    }
}

pub(crate) async fn fetch(app: &AppHandle) -> Result<Option<RuntimeManifest>, String> {
    let Some((platform, arch)) = manifest_target(
        std::env::consts::OS,
        std::env::consts::ARCH,
        &config::get_dsh_download_url()?,
    ) else {
        return Ok(None);
    };
    let url = format!(
        "{}/manifests/runtime-{platform}-{arch}.json",
        config::RUNTIME_DOWNLOAD_BASE_URL
    );
    let client = config::proxy::http_client_builder(app)?
        .user_agent("Td-Agent")
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("RUNTIME_MANIFEST_FETCH_FAILED: {error}"))?;
    fetch_from(&client, &url, platform, arch).await.map(Some)
}

async fn fetch_from(
    client: &reqwest::Client,
    url: &str,
    platform: &str,
    arch: &str,
) -> Result<RuntimeManifest, String> {
    let manifest = client
        .get(url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| format!("RUNTIME_MANIFEST_FETCH_FAILED: {error}"))?
        .json::<RuntimeManifest>()
        .await
        .map_err(|error| format!("RUNTIME_MANIFEST_INVALID: {error}"))?;
    manifest.validate(platform, arch)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn fixture() -> serde_json::Value {
        serde_json::json!({
            "schemaVersion": 1,
            "platform": "macos",
            "arch": "arm64",
            "node": {
                "version": "22.22.0",
                "url": "https://tdcunchu.oss-cn-beijing.aliyuncs.com/td-agent/runtime/node/22.22.0/node-v22.22.0-darwin-arm64.tar.gz",
                "sha256": "5ed4db0fcf1eaf84d91ad12462631d73bf4576c1377e192d222e48026a902640"
            },
            "pnpm": {
                "version": "11.7.0",
                "url": "https://tdcunchu.oss-cn-beijing.aliyuncs.com/td-agent/runtime/pnpm/11.7.0/pnpm-11.7.0.tgz",
                "sha256": "deafa7ec98a1218b6a047289b92fbe2395c1e22d3495bb711653013218ee15ee"
            },
            "dsh": {
                "version": "0.2.1-rc.2",
                "tag": "dsh-0.2.1-rc.2-39022695148",
                "url": "https://tdcunchu.oss-cn-beijing.aliyuncs.com/td-agent/runtime/dsh/dsh-0.2.1-rc.2-39022695148/deepseek-harness-pkg-macos-arm64.zip",
                "sha256": "3e00d68b6946c55113ba49b8bed6c7c2008de71812e24d6e56af8ac2dbc1c3c9"
            }
        })
    }

    #[test]
    fn published_manifest_selects_matching_assets_and_preserves_release_identity() {
        let manifest: RuntimeManifest = serde_json::from_value(fixture()).unwrap();
        let manifest = manifest.validate("macos", "arm64").unwrap();
        let dsh = manifest.dsh_package();
        assert_eq!(dsh.tag, "dsh-0.2.1-rc.2-39022695148");
        assert_eq!(dsh.commit, "39022695148");
        assert_eq!(
            dsh.digest.as_deref(),
            Some("3e00d68b6946c55113ba49b8bed6c7c2008de71812e24d6e56af8ac2dbc1c3c9")
        );
        assert_eq!(
            manifest.asset(InstallKind::Node, None).unwrap().version,
            "22.22.0"
        );
        assert_eq!(
            manifest.asset(InstallKind::Pnpm, None).unwrap().version,
            "11.7.0"
        );
        assert_eq!(
            manifest.asset(InstallKind::Dsh, Some(&dsh)).unwrap().url,
            dsh.asset_url
        );
        let other = LatestDshPkg {
            tag: "dsh-0.2.1-rc.1-1".into(),
            ..dsh
        };
        assert!(manifest.asset(InstallKind::Dsh, Some(&other)).is_none());
        assert!(manifest.asset(InstallKind::Dsh, None).is_none());
        assert!(manifest.asset(InstallKind::Git, None).is_none());
    }

    #[test]
    fn rejects_inconsistent_schema_versions_tags_and_digests() {
        for (pointer, value) in [
            ("/schemaVersion", serde_json::json!(2)),
            ("/platform", serde_json::json!("windows")),
            ("/arch", serde_json::json!("x64")),
            ("/node/version", serde_json::json!("24.0.0")),
            ("/pnpm/version", serde_json::json!("11.8.0")),
            ("/dsh/version", serde_json::json!("latest")),
            ("/dsh/tag", serde_json::json!("dsh-0.2.1-rc.1-39022695148")),
            ("/node/sha256", serde_json::json!("")),
            ("/dsh/sha256", serde_json::json!("g".repeat(64))),
            ("/pnpm/sha256", serde_json::json!("0".repeat(64))),
        ] {
            let mut source = fixture();
            *source.pointer_mut(pointer).unwrap() = value;
            let manifest: RuntimeManifest = serde_json::from_value(source).unwrap();
            assert!(
                manifest
                    .validate("macos", "arm64")
                    .unwrap_err()
                    .starts_with("RUNTIME_MANIFEST_INVALID:"),
                "{pointer}"
            );
        }
        let mut missing = fixture();
        missing.as_object_mut().unwrap().remove("dsh");
        assert!(serde_json::from_value::<RuntimeManifest>(missing).is_err());
    }

    #[test]
    fn rejects_urls_outside_the_exact_published_asset_paths() {
        for url in [
            "http://tdcunchu.oss-cn-beijing.aliyuncs.com/td-agent/runtime/pnpm/11.7.0/pnpm-11.7.0.tgz",
            "https://other.oss-cn-beijing.aliyuncs.com/td-agent/runtime/pnpm/11.7.0/pnpm-11.7.0.tgz",
            "https://tdcunchu.oss-cn-beijing.aliyuncs.com.evil.test/td-agent/runtime/pnpm/11.7.0/pnpm-11.7.0.tgz",
            "https://tdcunchu.oss-cn-beijing.aliyuncs.com/td-agent/runtime/pnpm/11.7.0/pnpm-11.7.0.tgz?override=1",
        ] {
            let mut source = fixture();
            source["pnpm"]["url"] = url.into();
            let manifest: RuntimeManifest = serde_json::from_value(source).unwrap();
            assert!(manifest.validate("macos", "arm64").is_err(), "{url}");
        }
    }

    #[test]
    fn selects_matching_manifests_for_windows_and_both_mac_architectures() {
        for (os, arch, filename, expected_arch) in [
            (
                "macos",
                "aarch64",
                "deepseek-harness-pkg-macos-arm64.zip",
                "arm64",
            ),
            (
                "macos",
                "x86_64",
                "deepseek-harness-pkg-macos-x64.zip",
                "x64",
            ),
            (
                "windows",
                "x86_64",
                "deepseek-harness-pkg-windows.zip",
                "x64",
            ),
            (
                "windows",
                "aarch64",
                "deepseek-harness-pkg-windows.zip",
                "arm64",
            ),
        ] {
            assert_eq!(
                manifest_target(os, arch, filename),
                Some((os, expected_arch))
            );
        }
        assert_eq!(
            manifest_target("macos", "aarch64", "deepseek-harness-pkg-macos-x64.zip"),
            Some(("macos", "x64"))
        );
        for (os, arch, filename) in [
            ("linux", "x86_64", "deepseek-harness-pkg-linux.zip"),
            ("macos", "x86_64", "deepseek-harness-pkg-windows.zip"),
            ("windows", "x86", "deepseek-harness-pkg-windows.zip"),
        ] {
            assert!(manifest_target(os, arch, filename).is_none());
        }
    }

    #[test]
    fn accepts_platform_assets_and_rejects_mismatched_platforms_or_git() {
        for (platform, arch, node_name, node_sha, dsh_name, dsh_sha, git_name, git_sha) in [
            (
                "macos",
                "x64",
                "node-v22.22.0-darwin-x64.tar.gz",
                "5ea50c9d6dea3dfa3abb66b2656f7a4e1c8cef23432b558d45fb538c7b5dedce",
                "deepseek-harness-pkg-macos-x64.zip",
                "5857c663bc218d842fd23d8c967dc4c954dd58d16b18a440a111c8e3f9fc9da3",
                "",
                "",
            ),
            (
                "windows",
                "x64",
                "node-v22.22.0-win-x64.zip",
                "c97fa376d2becdc8863fcd3ca2dd9a83a9f3468ee7ccf7a6d076ec66a645c77a",
                "deepseek-harness-pkg-windows.zip",
                "f550178cac006bc8a984ecb3500c3536b13ff2183381264bd0d36ea4f4ab6022",
                "MinGit-2.53.0.2-64-bit.zip",
                "d4bf83d6a860ccae9af44e508e1e00a39f09db6fa78a9ba5543b94d87ca22a29",
            ),
            (
                "windows",
                "arm64",
                "node-v22.22.0-win-x64.zip",
                "c97fa376d2becdc8863fcd3ca2dd9a83a9f3468ee7ccf7a6d076ec66a645c77a",
                "deepseek-harness-pkg-windows.zip",
                "f550178cac006bc8a984ecb3500c3536b13ff2183381264bd0d36ea4f4ab6022",
                "MinGit-2.53.0.2-arm64.zip",
                "842d50edc6bbcf39693e60a8ebb9dabb89b96b932b63aae12d218522b3e497f3",
            ),
        ] {
            let mut source = fixture();
            source["platform"] = platform.into();
            source["arch"] = arch.into();
            source["node"]["url"] = format!("https://tdcunchu.oss-cn-beijing.aliyuncs.com/td-agent/runtime/node/22.22.0/{node_name}").into();
            source["node"]["sha256"] = node_sha.into();
            source["dsh"]["url"] = format!("https://tdcunchu.oss-cn-beijing.aliyuncs.com/td-agent/runtime/dsh/dsh-0.2.1-rc.2-39022695148/{dsh_name}").into();
            source["dsh"]["sha256"] = dsh_sha.into();
            if platform == "windows" {
                source["git"] = serde_json::json!({
                    "version": "2.53.0.2",
                    "url": format!("https://tdcunchu.oss-cn-beijing.aliyuncs.com/td-agent/runtime/git/2.53.0.2/{git_name}"),
                    "sha256": git_sha,
                });
            }
            let manifest: RuntimeManifest = serde_json::from_value(source.clone()).unwrap();
            let manifest = manifest.validate(platform, arch).unwrap();
            assert!(manifest
                .asset(InstallKind::Node, None)
                .unwrap()
                .url
                .ends_with(node_name));
            assert_eq!(
                manifest.asset(InstallKind::Node, None).unwrap().sha256,
                node_sha
            );
            let dsh = manifest.dsh_package();
            assert!(dsh.asset_url.ends_with(dsh_name));
            assert_eq!(dsh.digest.as_deref(), Some(dsh_sha));
            if platform == "windows" {
                assert_eq!(
                    manifest.asset(InstallKind::Git, None).unwrap().sha256,
                    git_sha
                );
            } else {
                assert!(manifest.asset(InstallKind::Git, None).is_none());
            }
            if platform == "windows" {
                for value in [
                    serde_json::Value::Null,
                    serde_json::json!({"version":"2.53.0.2", "url": "https://other.test/git.zip", "sha256": git_sha}),
                ] {
                    let mut invalid = source.clone();
                    invalid["git"] = value;
                    let manifest: RuntimeManifest = serde_json::from_value(invalid).unwrap();
                    assert!(manifest.validate(platform, arch).is_err());
                }
                for (field, value) in [
                    ("version", "2.52.0.1".to_string()),
                    ("sha256", "0".repeat(64)),
                    ("url", format!("https://tdcunchu.oss-cn-beijing.aliyuncs.com/td-agent/runtime/git/2.53.0.2/MinGit-2.53.0.2-{}.zip", if arch == "arm64" { "64-bit" } else { "arm64" })),
                ] {
                    let mut invalid = source.clone();
                    invalid["git"][field] = value.into();
                    let manifest: RuntimeManifest = serde_json::from_value(invalid).unwrap();
                    assert!(manifest.validate(platform, arch).is_err(), "{platform}-{arch}: {field}");
                }
            }
            let manifest: RuntimeManifest = serde_json::from_value(source).unwrap();
            assert!(manifest.validate("macos", "arm64").is_err());
        }
    }

    #[tokio::test]
    async fn fetches_and_validates_the_http_manifest_before_selecting_assets() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = vec![];
            while !request.ends_with(b"\r\n\r\n") {
                assert!(request.len() < 4096);
                request.push(stream.read_u8().await.unwrap());
            }
            let body = fixture().to_string();
            stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
            String::from_utf8(request).unwrap()
        });
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let manifest = fetch_from(
            &client,
            &format!("http://{address}/runtime.json"),
            "macos",
            "arm64",
        )
        .await
        .unwrap();
        assert_eq!(manifest.dsh_package().tag, "dsh-0.2.1-rc.2-39022695148");
        assert!(server
            .await
            .unwrap()
            .starts_with("GET /runtime.json HTTP/1.1\r\n"));
    }

    #[tokio::test]
    async fn rejects_http_manifest_for_a_different_requested_architecture() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = vec![];
            while !request.ends_with(b"\r\n\r\n") {
                assert!(request.len() < 4096);
                request.push(stream.read_u8().await.unwrap());
            }
            let body = fixture().to_string();
            stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
        });
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        let error = fetch_from(
            &client,
            &format!("http://{address}/runtime.json"),
            "macos",
            "x64",
        )
        .await
        .unwrap_err();
        assert_eq!(
            error,
            "RUNTIME_MANIFEST_INVALID: unsupported schema or platform"
        );
        server.await.unwrap();
    }

    #[tokio::test]
    async fn missing_manifest_is_an_error_instead_of_an_unverified_download() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = vec![];
            while !request.ends_with(b"\r\n\r\n") {
                assert!(request.len() < 4096);
                request.push(stream.read_u8().await.unwrap());
            }
            stream
                .write_all(
                    b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await
                .unwrap();
        });
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let error = fetch_from(
            &client,
            &format!("http://{address}/runtime.json"),
            "macos",
            "arm64",
        )
        .await
        .unwrap_err();
        assert!(error.starts_with("RUNTIME_MANIFEST_FETCH_FAILED:"));
        assert!(error.contains("404"));
        server.await.unwrap();
    }
}
