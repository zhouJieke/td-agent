use sha2::{Digest, Sha256};
use std::path::Path;

use crate::utils::{patch_core_file, patch_dsh, PatchOutcome};

const MCP_INDEX_JS: &str = "node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js";
const READY_ANCHOR: &str = "\tconst outcome = await connection.ready;";
const READY_PATCHED: &str = r#"	// issue #1022: non-strict MCP connections must not block Host readiness.
	if (!config.failOnStartupError) {
		connection.ready.catch((error) => ctx.logger.error(`mcp-client(${config.serverName}): background startup failed: ${String(error)}`));
		return;
	}
	const outcome = await connection.ready;"#;

const OAUTH_SOURCE: &str = include_str!("mcp_oauth.mjs");
const OAUTH_IMPORT: &str = "import * as desktopMcpSdk from \"@modelcontextprotocol/client\";\n";
const TRANSPORT_ANCHOR: &str = "case \"streamable-http\": return new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } });";
const TRANSPORT_PATCHED: &str = "case \"streamable-http\": return new StreamableHTTPClientTransport(new URL(config.url), { authProvider: desktopMcpOAuth(desktopMcpSdk, credentials).provider(config), requestInit: { headers: config.headers } });";
const NEGOTIATION_ANCHOR: &str = "versionNegotiation: { mode: \"auto\" }";
const CONNECT_ANCHOR: &str = "await generation.connect(transport);";
const CONNECT_PATCHED: &str = r#"try {
				await generation.connect(transport);
			} catch (error) {
				if (disposed || config.transport !== "streamable-http" || generation.transport !== void 0 || !(error instanceof desktopMcpSdk.SdkHttpError) || error.code !== desktopMcpSdk.SdkErrorCode.EraNegotiationFailed || error.status !== 500) throw error;
				transport = createTransport(config, ctx.credentials);
				await generation.connect(transport, { prior: { kind: "legacy" } });
			}"#;

fn patch_source(source: &str) -> PatchOutcome {
    if source.matches(CONNECT_PATCHED).count() > 1 {
        return PatchOutcome::AnchorMissing;
    }
    let normalized = source.replacen(CONNECT_PATCHED, CONNECT_ANCHOR, 1);
    let patched = match patch_oauth_source(&normalized) {
        PatchOutcome::Patched(patched) => patched,
        PatchOutcome::AlreadyPatched => normalized,
        outcome => return outcome,
    };
    let patched = if patched.contains(NEGOTIATION_ANCHOR) {
        if patched.matches(NEGOTIATION_ANCHOR).count() != 1
            || patched.matches(CONNECT_ANCHOR).count() != 1
            || !patched.starts_with(OAUTH_IMPORT)
        {
            return PatchOutcome::AnchorMissing;
        }
        patched.replacen(CONNECT_ANCHOR, CONNECT_PATCHED, 1)
    } else {
        if source.contains(CONNECT_PATCHED) {
            return PatchOutcome::AnchorMissing;
        }
        patched
    };
    if patched == source {
        PatchOutcome::AlreadyPatched
    } else {
        PatchOutcome::Patched(patched)
    }
}

fn patch_oauth_source(source: &str) -> PatchOutcome {
    if source.contains(OAUTH_IMPORT) || source.contains("desktopMcpOAuth") {
        let Some(start) = source.find(
            "\nimport { createHash as oauthHash, randomBytes as oauthRandom } from 'node:crypto'\n",
        ) else {
            return PatchOutcome::AnchorMissing;
        };
        let (prefix, helper) = source.split_at(start + 1);
        if !prefix.starts_with(OAUTH_IMPORT)
            || [
                OAUTH_IMPORT,
                TRANSPORT_PATCHED,
                READY_PATCHED,
                "function createTransport(config, credentials) {",
                "const inject = [\"tools\", \"credentials\"];",
            ]
            .iter()
            .any(|anchor| prefix.matches(anchor).count() != 1)
            || prefix
                .matches("transport = createTransport(config, ctx.credentials);")
                .count()
                + prefix
                    .matches("generation.connect(createTransport(config, ctx.credentials));")
                    .count()
                != 1
            || source
                .matches("export function desktopMcpOAuth(sdk, credentials) {")
                .count()
                != 1
        {
            return PatchOutcome::AnchorMissing;
        }
        if helper == OAUTH_SOURCE {
            return PatchOutcome::AlreadyPatched;
        }
        return if [
            "d2f9d978bb36c9324556af502fa92a45fe83e72818427b4d9969b8a23b376974",
            "9aa1dc3cf7c75f913688b411607a2858c38a4a96132c5ba3c60630581d3333b9",
        ]
        .contains(&format!("{:x}", Sha256::digest(helper.as_bytes())).as_str())
        {
            PatchOutcome::Patched(format!("{prefix}{OAUTH_SOURCE}"))
        } else {
            PatchOutcome::AnchorMissing
        };
    }
    if !source.contains(READY_ANCHOR)
        || !source.contains(TRANSPORT_ANCHOR)
        || !source.contains("function createTransport(config) {")
        || !(source.contains("transport = createTransport(config);")
            || source.contains("generation.connect(createTransport(config));"))
        || !source.contains("const inject = [\"tools\"];")
    {
        return PatchOutcome::AnchorMissing;
    }
    let ready = if source.contains(READY_PATCHED) {
        source.to_owned()
    } else {
        source.replacen(READY_ANCHOR, READY_PATCHED, 1)
    };
    if source.contains("@modelcontextprotocol/sdk/client/") {
        return if source.contains(READY_PATCHED) {
            PatchOutcome::AlreadyPatched
        } else {
            PatchOutcome::Patched(ready)
        };
    }
    let patched = ready
        .replacen(
            "function createTransport(config) {",
            "function createTransport(config, credentials) {",
            1,
        )
        .replacen(
            "transport = createTransport(config);",
            "transport = createTransport(config, ctx.credentials);",
            1,
        )
        .replacen(
            "generation.connect(createTransport(config));",
            "generation.connect(createTransport(config, ctx.credentials));",
            1,
        )
        .replacen(
            "const inject = [\"tools\"];",
            "const inject = [\"tools\", \"credentials\"];",
            1,
        )
        .replacen(TRANSPORT_ANCHOR, TRANSPORT_PATCHED, 1);
    PatchOutcome::Patched(format!("{OAUTH_IMPORT}{patched}\n{OAUTH_SOURCE}"))
}

pub fn apply_at(core_dir: &Path) -> Result<(), String> {
    patch_core_file(core_dir, MCP_INDEX_JS, patch_source)
}

pub fn apply(app_handle: &tauri::AppHandle) -> Result<(), String> {
    patch_dsh(app_handle, MCP_INDEX_JS, patch_source)
}

#[cfg(test)]
mod tests {
    use super::*;

    const OAUTH_1101: &str = include_str!("../../../../test/fixtures/mcp-oauth-1101.mjs");
    const OAUTH_BEFORE_JSON: &str =
        include_str!("../../../../test/fixtures/mcp-oauth-before-json.mjs");

    #[test]
    fn upgrades_http_negotiation_on_fresh_and_existing_oauth_sources() {
        let original = format!("function createTransport(config) {{\n{TRANSPORT_ANCHOR}\n}}\ntransport = createTransport(config);\n{NEGOTIATION_ANCHOR}\n{CONNECT_ANCHOR}\nconst inject = [\"tools\"];\n{READY_ANCHOR}");
        let current = format!(
            "{}{OAUTH_SOURCE}",
            oauth_prefix(&format!("transport = createTransport(config, ctx.credentials);\n{NEGOTIATION_ANCHOR}\n{CONNECT_ANCHOR}"))
        );
        for source in [original, current] {
            let PatchOutcome::Patched(patched) = patch_source(&source) else {
                panic!("expected negotiation fallback patch")
            };
            assert_eq!(patched.matches(CONNECT_PATCHED).count(), 1);
            assert_eq!(patched.matches(OAUTH_SOURCE).count(), 1);
            assert_eq!(patch_source(&patched), PatchOutcome::AlreadyPatched);
            assert_eq!(
                patch_source(&patched.replacen(NEGOTIATION_ANCHOR, "", 1)),
                PatchOutcome::AnchorMissing
            );
        }
    }

    #[test]
    fn negotiation_patch_rejects_missing_or_duplicate_connection_anchors() {
        let prefix = oauth_prefix(&format!("transport = createTransport(config, ctx.credentials);\n{NEGOTIATION_ANCHOR}\n{CONNECT_ANCHOR}"));
        for anchor in [NEGOTIATION_ANCHOR, CONNECT_ANCHOR] {
            let source = format!("{prefix}{OAUTH_SOURCE}");
            assert_eq!(
                patch_source(&source.replacen(anchor, &format!("{anchor}\n{anchor}"), 1)),
                PatchOutcome::AnchorMissing
            );
        }
        assert_eq!(
            patch_source(&format!(
                "{}{OAUTH_SOURCE}",
                prefix.replace(CONNECT_ANCHOR, "")
            )),
            PatchOutcome::AnchorMissing
        );
    }

    fn oauth_prefix(call: &str) -> String {
        r#"import * as desktopMcpSdk from "@modelcontextprotocol/client";
function createTransport(config, credentials) {
case "streamable-http": return new StreamableHTTPClientTransport(new URL(config.url), { authProvider: desktopMcpOAuth(desktopMcpSdk, credentials).provider(config), requestInit: { headers: config.headers } });
}
__CONNECT__
const inject = ["tools", "credentials"];
ctx.effect(() => dispose, "mcp-client.connection");
	// issue #1022: non-strict MCP connections must not block Host readiness.
	if (!config.failOnStartupError) {
		connection.ready.catch((error) => ctx.logger.error(`mcp-client(${config.serverName}): background startup failed: ${String(error)}`));
		return;
	}
	const outcome = await connection.ready;
if (outcome.error !== void 0 && config.failOnStartupError) throw outcome.error;
export { activate, inject };
"#
        .replace("__CONNECT__", call)
    }

    #[test]
    fn oauth_upgrade_fixture_matches_the_1101_release() {
        assert_eq!(
            format!("{:x}", Sha256::digest(OAUTH_1101.as_bytes())),
            "d2f9d978bb36c9324556af502fa92a45fe83e72818427b4d9969b8a23b376974"
        );
    }

    #[test]
    fn oauth_upgrade_fixture_matches_the_pre_json_helper() {
        assert_eq!(
            format!("{:x}", Sha256::digest(OAUTH_BEFORE_JSON.as_bytes())),
            "9aa1dc3cf7c75f913688b411607a2858c38a4a96132c5ba3c60630581d3333b9"
        );
    }

    #[test]
    fn upgrades_known_oauth_helpers_without_changing_core_wiring() {
        for helper in [OAUTH_1101, OAUTH_BEFORE_JSON] {
            assert!(
                helper != OAUTH_SOURCE,
                "upgrade requires a newer OAuth helper"
            );
            for call in [
                "transport = createTransport(config, ctx.credentials);",
                "generation.connect(createTransport(config, ctx.credentials));",
            ] {
                let prefix = oauth_prefix(call);
                let source = format!("{prefix}{helper}");
                let outcome = patch_source(&source);
                let PatchOutcome::Patched(patched) = outcome else {
                    panic!("expected OAuth helper upgrade for {call}, got {outcome:?}");
                };
                assert_eq!(patched, format!("{prefix}{OAUTH_SOURCE}"));
                assert_eq!(patched.matches(OAUTH_SOURCE).count(), 1);
                assert!(!patched.contains(helper));
                assert_eq!(patch_source(&patched), PatchOutcome::AlreadyPatched);
            }
        }
    }

    #[test]
    fn current_oauth_helper_is_idempotent_with_complete_wiring() {
        let source = format!(
            "{}{OAUTH_SOURCE}",
            oauth_prefix("transport = createTransport(config, ctx.credentials);")
        );
        assert_eq!(patch_source(&source), PatchOutcome::AlreadyPatched);
    }

    #[test]
    fn oauth_patches_reject_missing_or_duplicate_wiring() {
        for helper in [OAUTH_1101, OAUTH_BEFORE_JSON, OAUTH_SOURCE] {
            let source = format!(
                "{}{helper}",
                oauth_prefix("transport = createTransport(config, ctx.credentials);")
            );
            for anchor in [
                "import * as desktopMcpSdk from \"@modelcontextprotocol/client\";\n",
                "function createTransport(config, credentials) {",
                "case \"streamable-http\": return new StreamableHTTPClientTransport(new URL(config.url), { authProvider: desktopMcpOAuth(desktopMcpSdk, credentials).provider(config), requestInit: { headers: config.headers } });",
                "transport = createTransport(config, ctx.credentials);",
                "const inject = [\"tools\", \"credentials\"];",
                READY_PATCHED,
                "export function desktopMcpOAuth(sdk, credentials) {",
            ] {
                assert_eq!(
                    patch_source(&source.replacen(anchor, "", 1)),
                    PatchOutcome::AnchorMissing,
                    "missing anchor: {anchor}"
                );
                assert_eq!(
                    patch_source(&source.replacen(anchor, &format!("{anchor}\n{anchor}"), 1)),
                    PatchOutcome::AnchorMissing,
                    "duplicate anchor: {anchor}"
                );
            }
            assert_eq!(
                patch_source(&format!("const upstream = true;\n{source}")),
                PatchOutcome::AnchorMissing
            );
            assert_eq!(
                patch_source(&source.replacen(
                    "transport = createTransport(config, ctx.credentials);",
                    "transport = createTransport(config, ctx.credentials);\ngeneration.connect(createTransport(config, ctx.credentials));",
                    1
                )),
                PatchOutcome::AnchorMissing
            );
        }
    }

    #[test]
    fn oauth_patches_reject_unknown_or_unbounded_helpers() {
        for helper in [OAUTH_1101, OAUTH_BEFORE_JSON, OAUTH_SOURCE] {
            let prefix = oauth_prefix("transport = createTransport(config, ctx.credentials);");
            for (case, tail) in [
                (
                    "trailing declaration",
                    format!("{helper}\nconst upstream = 1;\n"),
                ),
                (
                    "trailing function",
                    format!("{helper}\nfunction upstream() {{}}\n"),
                ),
                ("duplicate helper", format!("{helper}{helper}")),
                ("trimmed helper", helper.trim_end().to_owned()),
                ("truncated helper", helper[..helper.len() - 2].to_owned()),
                (
                    "unknown helper",
                    helper.replace(
                        "const attempts = new Map()",
                        "const attempts = new WeakMap()",
                    ),
                ),
            ] {
                assert_eq!(
                    patch_source(&format!("{prefix}{tail}")),
                    PatchOutcome::AnchorMissing,
                    "unrecognized helper: {case}"
                );
            }
        }
    }

    #[test]
    fn patch_read_failure_is_reported_before_launch() {
        let core = tempfile::tempdir().unwrap();
        let target = core.path().join(MCP_INDEX_JS);
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(target, [0xff]).unwrap();
        let error = apply_at(core.path()).expect_err("unreadable MCP file must fail");
        assert!(error.starts_with("DSH_PATCH_READ:"));
    }

    #[test]
    fn legacy_sdk_keeps_existing_transport_without_unavailable_imports() {
        let source = format!("import {{ Client }} from \"@modelcontextprotocol/sdk/client/index.js\";\nfunction createTransport(config) {{\n{TRANSPORT_ANCHOR}\n}}\ngeneration.connect(createTransport(config));\nconst inject = [\"tools\"];\n{READY_ANCHOR}");
        let PatchOutcome::Patched(patched) = patch_source(&source) else {
            panic!("expected legacy readiness patch")
        };
        assert!(patched.contains(READY_PATCHED));
        assert!(patched.contains(TRANSPORT_ANCHOR));
        assert!(!patched.contains(OAUTH_IMPORT));
        assert!(!patched.contains(OAUTH_SOURCE));
        assert_eq!(patch_source(&patched), PatchOutcome::AlreadyPatched);
    }

    #[test]
    fn legacy_transport_receives_credentials_and_remains_idempotent() {
        let source = format!("function createTransport(config) {{\n{TRANSPORT_ANCHOR}\n}}\ngeneration.connect(createTransport(config));\nconst inject = [\"tools\"];\n{READY_ANCHOR}");
        let PatchOutcome::Patched(patched) = patch_source(&source) else {
            panic!("expected legacy transport patch")
        };
        assert!(patched.contains("generation.connect(createTransport(config, ctx.credentials));"));
        assert!(patched.contains(TRANSPORT_PATCHED));
        assert!(patched.contains("const inject = [\"tools\", \"credentials\"];"));
        assert_eq!(patch_source(&patched), PatchOutcome::AlreadyPatched);
    }

    #[test]
    fn readiness_patch_is_idempotent_and_preserves_surrounding_lifecycle() {
        let source = format!("function createTransport(config) {{\n{TRANSPORT_ANCHOR}\n}}\ntransport = createTransport(config);\nconst inject = [\"tools\"];\nctx.effect(() => dispose, \"mcp-client.connection\");\n{READY_ANCHOR}\nif (outcome.error !== void 0 && config.failOnStartupError) throw outcome.error;");
        let PatchOutcome::Patched(patched) = patch_source(&source) else {
            panic!("expected patch")
        };
        assert!(patched.contains(READY_PATCHED));
        assert!(patched.contains(TRANSPORT_PATCHED));
        assert!(patched.contains("createTransport(config, ctx.credentials)"));
        assert!(patched.contains("const inject = [\"tools\", \"credentials\"];"));
        assert!(patched.contains(OAUTH_SOURCE));
        assert_eq!(patch_source(&patched), PatchOutcome::AlreadyPatched);
        let previous = source.replace(READY_ANCHOR, READY_PATCHED);
        let PatchOutcome::Patched(upgraded) = patch_source(&previous) else {
            panic!("expected readiness-only patch upgrade")
        };
        assert_eq!(upgraded.matches(READY_PATCHED).count(), 1);
        assert!(upgraded.contains(TRANSPORT_PATCHED));
        assert_eq!(
            patch_source("upstream changed"),
            PatchOutcome::AnchorMissing
        );
    }
}
