use std::path::Path;

use crate::utils::{patch_core_file, PatchOutcome};

const CLIENT: &str = "node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js";
const CONVERSATION_CLIENT: &str =
    "node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js";
const ORIGINAL: &str = "const productTitle = \"DeepSeek Harness\";";
const DESKTOP_CONDITION: &str = "new URLSearchParams(globalThis.location.search).has(\"dshDesktop\") && !(\"ReactNativeWebView\" in globalThis)";

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

fn patch_conversation(source: &str) -> PatchOutcome {
    let mut patched = source.to_string();
    let mut matched = false;
    for (key, original, current) in [
        ("hero.headline", "TaskPulse", env!("DSH_PRODUCT_NAME")),
        ("hero.headline", "探索未至之境", env!("DSH_PRODUCT_NAME")),
        (
            "hero.headline",
            "Into the Unknown",
            env!("DSH_PRODUCT_NAME"),
        ),
        ("hero.preview", "牛逼版", "企业版"),
        ("hero.preview", "预览版", "企业版"),
        ("hero.preview", "Preview", "企业版"),
    ] {
        let original = serde_json::to_string(original).unwrap();
        let Ok(anchor) = regex::Regex::new(&format!(
            r#""{}": (?:{} \? "(?:[^"\\]|\\.)*" : )?{}"#,
            regex::escape(key),
            regex::escape(DESKTOP_CONDITION),
            regex::escape(&original),
        )) else {
            return PatchOutcome::AnchorMissing;
        };
        let replacement = format!(
            "\"{key}\": {DESKTOP_CONDITION} ? {} : {original}",
            serde_json::to_string(current).unwrap()
        );
        matched |= anchor.is_match(&patched);
        patched = anchor
            .replace_all(&patched, regex::NoExpand(&replacement))
            .into_owned();
    }
    if patched != source {
        PatchOutcome::Patched(patched)
    } else if matched {
        PatchOutcome::AlreadyPatched
    } else {
        PatchOutcome::AnchorMissing
    }
}

pub fn apply_at(core_dir: &Path) -> Result<(), String> {
    patch_core_file(core_dir, CLIENT, patch_source)?;
    patch_core_file(core_dir, CONVERSATION_CLIENT, patch_conversation)
}

pub fn apply(app_handle: &tauri::AppHandle) -> Result<(), String> {
    apply_at(&crate::service::core::active_core_dir(app_handle))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_bundle_patches_the_nested_oss_conversation() {
        let root = std::env::temp_dir().join(format!(
            "desktop-branding-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let client = root.join("node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js");
        std::fs::create_dir_all(client.parent().unwrap()).unwrap();
        std::fs::write(
            &client,
            "{\"hero.headline\": \"TaskPulse\", \"hero.preview\": \"牛逼版\"}",
        )
        .unwrap();
        apply_at(&root).unwrap();
        let patched = std::fs::read_to_string(&client).unwrap();
        apply_at(&root).unwrap();
        assert_eq!(std::fs::read_to_string(&client).unwrap(), patched);
        std::fs::remove_dir_all(&root).unwrap();
        assert!(patched.contains(env!("DSH_PRODUCT_NAME")));
        assert!(!patched.contains("探索未至之境"));
        assert!(patched.contains("企业版"));
        assert!(patched.contains(".has(\"dshDesktop\")"));
        assert!(patched.contains("ReactNativeWebView"));
    }

    #[test]
    fn conversation_headline_refreshes_existing_desktop_copies() {
        for (headline, original) in [
            ("\"探索未至之境\"".to_string(), "探索未至之境"),
            ("\"Into the Unknown\"".to_string(), "Into the Unknown"),
            (
                format!("{DESKTOP_CONDITION} ? \"探索未至之境\" : \"TaskPulse\""),
                "TaskPulse",
            ),
        ] {
            let source = format!("{{\"hero.headline\": {headline}}}");
            let expected = format!(
                "{{\"hero.headline\": {DESKTOP_CONDITION} ? \"{}\" : \"{original}\"}}",
                env!("DSH_PRODUCT_NAME")
            );
            assert_eq!(
                patch_conversation(&source),
                PatchOutcome::Patched(expected.clone())
            );
            assert_eq!(patch_conversation(&expected), PatchOutcome::AlreadyPatched);
        }
        assert_eq!(patch_conversation("{}"), PatchOutcome::AnchorMissing);
    }

    #[test]
    fn conversation_badge_updates_new_and_previously_patched_cores() {
        for original in ["牛逼版", "预览版", "Preview"] {
            let expected =
                format!("{{\"hero.preview\": {DESKTOP_CONDITION} ? \"企业版\" : \"{original}\"}}");
            for value in [
                format!("\"{original}\""),
                format!("{DESKTOP_CONDITION} ? \"预览版\" : \"{original}\""),
            ] {
                let source = format!("{{\"hero.preview\": {value}}}");
                assert_eq!(
                    patch_conversation(&source),
                    PatchOutcome::Patched(expected.clone())
                );
            }
            assert_eq!(patch_conversation(&expected), PatchOutcome::AlreadyPatched);
        }
    }

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
