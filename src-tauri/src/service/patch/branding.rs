use std::path::Path;

use crate::utils::{patch_core_file, patch_dsh, PatchOutcome};

const CLIENT: &str = "node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js";
const ORIGINAL: &str = "const productTitle = \"DeepSeek Harness\";";

fn patch_source(source: &str) -> PatchOutcome {
    let prefix = "const productTitle = new URLSearchParams(globalThis.location.search).has(\"dshDesktop\") && !(\"ReactNativeWebView\" in globalThis) ? ";
    let suffix = " : \"DeepSeek Harness\";";
    let replacement = format!(
        "{prefix}{}{suffix}",
        serde_json::to_string(env!("DSH_PRODUCT_NAME")).unwrap()
    );
    let mut anchors = source.lines().map(str::trim).filter(|line| {
        *line == ORIGINAL
            || line
                .strip_prefix(prefix)
                .and_then(|value| value.strip_suffix(suffix))
                .is_some_and(|value| serde_json::from_str::<String>(value).is_ok())
    });
    let Some(anchor) = anchors.next() else {
        return PatchOutcome::AnchorMissing;
    };
    if anchors.next().is_some() || source.matches(anchor).count() != 1 {
        return PatchOutcome::AnchorMissing;
    }
    if anchor == replacement {
        return PatchOutcome::AlreadyPatched;
    }
    PatchOutcome::Patched(source.replacen(anchor, &replacement, 1))
}

pub fn apply_at(core_dir: &Path) -> Result<(), String> {
    patch_core_file(core_dir, CLIENT, patch_source)
}

pub fn apply(app_handle: &tauri::AppHandle) -> Result<(), String> {
    patch_dsh(app_handle, CLIENT, patch_source)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_title_preserves_the_original_web_and_mobile_name() {
        let source = format!("before();\n{ORIGINAL}\nafter();");
        let PatchOutcome::Patched(patched) = patch_source(&source) else {
            panic!("expected a desktop title patch");
        };
        assert!(patched.starts_with("before();\n"));
        assert!(patched.ends_with("\nafter();"));
        assert!(patched.contains(".has(\"dshDesktop\")"));
        assert!(patched.contains("!(\"ReactNativeWebView\" in globalThis)"));
        assert!(patched.contains(env!("DSH_PRODUCT_NAME")));
        assert!(patched.contains(": \"DeepSeek Harness\";"));
        assert_eq!(patch_source(&patched), PatchOutcome::AlreadyPatched);
    }

    #[test]
    fn missing_or_ambiguous_title_anchors_leave_the_core_untouched() {
        assert_eq!(
            patch_source("const productTitle = customTitle;"),
            PatchOutcome::AnchorMissing
        );
        assert_eq!(
            patch_source(&format!("{ORIGINAL}\n{ORIGINAL}")),
            PatchOutcome::AnchorMissing
        );
    }

    #[test]
    fn refreshes_an_existing_desktop_brand_after_an_application_update() {
        let PatchOutcome::Patched(patched) = patch_source(ORIGINAL) else {
            panic!("expected an initial desktop title patch");
        };
        let previous = patched.replace(env!("DSH_PRODUCT_NAME"), "Previous desktop name");
        assert_eq!(patch_source(&previous), PatchOutcome::Patched(patched));
    }
}
