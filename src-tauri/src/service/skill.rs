use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{self, Cursor, Read, Write},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use serde_yaml::Value;
use zip::ZipArchive;

const MAX_ENTRIES: usize = 1_000;
const MAX_ENTRY_BYTES: u64 = 8 * 1024 * 1024;
const MAX_EXTRACTED_BYTES: u64 = 32 * 1024 * 1024;
const VERSION_FILE_NAME: &str = ".dsh-tauri-skill-version.json";
const LOCK_FILE_NAME: &str = ".dsh-tauri-skill-install.lock";
const MAX_VERSION_FILE_BYTES: u64 = 4096;
const LOCK_TIMEOUT: Duration = Duration::from_secs(2);

struct Entry {
    index: usize,
    path: PathBuf,
    directory: bool,
    mode: Option<u32>,
}

pub(crate) fn validate_name(name: &str) -> Result<(), String> {
    let bytes = name.as_bytes();
    if bytes.is_empty()
        || bytes.len() > 64
        || !bytes[0].is_ascii_lowercase() && !bytes[0].is_ascii_digit()
        || !bytes[bytes.len() - 1].is_ascii_lowercase() && !bytes[bytes.len() - 1].is_ascii_digit()
        || bytes
            .iter()
            .any(|byte| !byte.is_ascii_lowercase() && !byte.is_ascii_digit() && *byte != b'-')
        || name.contains("--")
    {
        return Err("SKILL_NAME_INVALID: skill name cannot be used by the kernel".into());
    }
    Ok(())
}

pub(crate) fn validate_version(version: &str) -> Result<semver::Version, String> {
    if version.len() > 256 {
        return Err("SKILL_VERSION_INVALID: version is too long".into());
    }
    semver::Version::parse(version)
        .map_err(|_| "SKILL_VERSION_INVALID: invalid semantic version".into())
}

pub(crate) fn ensure_available(home: &Path, name: &str) -> Result<(), String> {
    validate_name(name)?;
    let root = home.join("skills");
    for path in [root.join(name), root.join(format!("{name}.md"))] {
        match fs::symlink_metadata(path) {
            Ok(_) => return Err(format!("SKILL_ALREADY_EXISTS: {name}")),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("SKILL_INSTALL_FAILED: {error}")),
        }
    }
    Ok(())
}

pub(crate) fn install(
    home: &Path,
    name: &str,
    bytes: &[u8],
    version: Option<&str>,
) -> Result<(), String> {
    ensure_available(home, name)?;
    if let Some(version) = version {
        validate_version(version)?;
    }
    let (staging, entries) = prepare(home, name, bytes)?;
    let result = (|| {
        let _lock = lock_skills(home)?;
        ensure_available(home, name)?;
        commit(
            home,
            name,
            &staging.path().join("payload"),
            &entries,
            version,
        )
    })();
    cleanup(staging);
    result
}

pub(crate) fn ensure_updatable(
    home: &Path,
    name: &str,
    expected_version: Option<&str>,
) -> Result<(), String> {
    validate_name(name)?;
    let root = home.join("skills");
    let root_metadata = fs::symlink_metadata(&root).map_err(update_target_error)?;
    if !root_metadata.is_dir() || is_link(&root_metadata) {
        return Err("SKILL_UPDATE_UNAVAILABLE: unsafe skill root".into());
    }
    match fs::symlink_metadata(root.join(format!("{name}.md"))) {
        Ok(_) => return Err("SKILL_UPDATE_UNAVAILABLE: conflicting flat skill".into()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(install_error(error)),
    }
    let target = root.join(name);
    let target_metadata = fs::symlink_metadata(&target).map_err(update_target_error)?;
    if !target_metadata.is_dir() || is_link(&target_metadata) {
        return Err("SKILL_UPDATE_UNAVAILABLE: unsafe skill directory".into());
    }
    let skill_metadata =
        fs::symlink_metadata(target.join("SKILL.md")).map_err(update_target_error)?;
    if !skill_metadata.is_file() || is_link(&skill_metadata) {
        return Err("SKILL_UPDATE_UNAVAILABLE: unsafe skill file".into());
    }
    if installed_version(&target)?.as_deref() != expected_version {
        return Err("SKILL_VERSION_CHANGED: installed version changed".into());
    }
    Ok(())
}

pub(crate) fn update(
    home: &Path,
    name: &str,
    bytes: &[u8],
    version: &str,
    expected_installed: Option<&str>,
) -> Result<(), String> {
    let mut latest = validate_version(version)?;
    if let Some(current) = expected_installed {
        let mut current = validate_version(current)?;
        latest.build = Default::default();
        current.build = Default::default();
        if latest <= current {
            return Err("SKILL_VERSION_INVALID: update is not newer".into());
        }
    }
    ensure_updatable(home, name, expected_installed)?;
    let (staging, entries) = prepare(home, name, bytes)?;
    let result = (|| {
        let _lock = lock_skills(home)?;
        ensure_updatable(home, name, expected_installed)?;
        replace(home, name, staging.path(), || {
            ensure_available(home, name)?;
            commit(
                home,
                name,
                &staging.path().join("payload"),
                &entries,
                Some(version),
            )
        })
    })();
    let backup = staging.path().join("backup");
    match fs::symlink_metadata(&backup) {
        Ok(_) => {
            let preserved = staging.keep().join("backup");
            return Err(format!(
                "{}; original files preserved at {}",
                result
                    .err()
                    .unwrap_or_else(|| "SKILL_UPDATE_CLEANUP_FAILED".into()),
                preserved.display()
            ));
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => {
            let preserved = staging.keep();
            return Err(format!(
                "SKILL_UPDATE_CLEANUP_FAILED: {error}; staging preserved at {}",
                preserved.display()
            ));
        }
    }
    cleanup(staging);
    result
}

pub(crate) async fn download_update(
    auth: &crate::service::auth::AuthService,
    home: PathBuf,
    name: String,
    expected_version: String,
    installed_version: Option<String>,
) -> Result<String, String> {
    auth.access_token().await?;
    validate_version(&expected_version)?;
    ensure_updatable(&home, &name, installed_version.as_deref())?;
    let download = auth.download_skill(&name, Some(&expected_version)).await?;
    let version = download
        .version
        .ok_or("SKILL_VERSION_UNAVAILABLE: download did not include a version")?;
    if version != expected_version {
        return Err(format!(
            "SKILL_VERSION_MISMATCH: expected={expected_version}, received={version}"
        ));
    }
    auth.access_token().await?;
    let actual_version = version.clone();
    tokio::task::spawn_blocking(move || {
        update(
            &home,
            &name,
            &download.bytes,
            &version,
            installed_version.as_deref(),
        )
    })
    .await
    .map_err(|error| format!("SKILL_INSTALL_FAILED: {error}"))??;
    Ok(actual_version)
}

fn prepare(
    home: &Path,
    name: &str,
    bytes: &[u8],
) -> Result<(tempfile::TempDir, Vec<Entry>), String> {
    let mut archive = ZipArchive::new(Cursor::new(bytes))
        .map_err(|error| invalid_package(&format!("invalid ZIP: {error}")))?;
    let entries = entries(&mut archive)?;
    fs::create_dir_all(home).map_err(install_error)?;
    let staging = tempfile::Builder::new()
        .prefix(".skill-install-")
        .tempdir_in(home)
        .map_err(install_error)?;
    let payload = staging.path().join("payload");
    fs::create_dir(&payload).map_err(install_error)?;
    extract(&mut archive, &entries, &payload)?;
    let metadata = fs::read(payload.join("SKILL.md")).map_err(install_error)?;
    validate_metadata(name, &metadata)?;
    Ok((staging, entries))
}

fn cleanup(staging: tempfile::TempDir) {
    if let Err(error) = staging.close() {
        log::warn!("Failed to clean up skill staging directory: {error}");
    }
}

fn entries(archive: &mut ZipArchive<Cursor<&[u8]>>) -> Result<Vec<Entry>, String> {
    if archive.len() == 0 || archive.len() > MAX_ENTRIES {
        return Err(invalid_package("invalid entry count"));
    }

    let mut raw = Vec::with_capacity(archive.len());
    let mut names = HashSet::new();
    let mut metadata_paths = Vec::new();
    let mut total = 0_u64;
    for index in 0..archive.len() {
        let file = archive
            .by_index(index)
            .map_err(|error| invalid_package(&format!("invalid ZIP entry: {error}")))?;
        let path = file.name().trim_end_matches('/');
        if path.is_empty()
            || file.name().contains('\\')
            || file.name().contains('\0')
            || file.enclosed_name().is_none()
            || path.split('/').any(|part| {
                part.is_empty()
                    || part == "."
                    || part == ".."
                    || part.contains(':')
                    || part.ends_with('.')
                    || part.ends_with(' ')
            })
        {
            return Err(invalid_package("unsafe ZIP entry path"));
        }
        if !names.insert(path.to_lowercase()) {
            return Err(invalid_package("duplicate ZIP entry"));
        }
        let mode = file.unix_mode();
        if let Some(kind) = mode.map(|value| value & 0o170000) {
            if kind != 0 && kind != 0o100000 && kind != 0o040000 {
                return Err(invalid_package("unsupported ZIP entry type"));
            }
        }
        if file.size() > MAX_ENTRY_BYTES {
            return Err(invalid_package("ZIP entry is too large"));
        }
        total = total
            .checked_add(file.size())
            .ok_or_else(|| invalid_package("ZIP is too large"))?;
        if total > MAX_EXTRACTED_BYTES {
            return Err(invalid_package("ZIP is too large"));
        }
        let parts: Vec<String> = path.split('/').map(str::to_owned).collect();
        if !file.is_dir() && parts.last().is_some_and(|part| part == "SKILL.md") {
            metadata_paths.push(parts.clone());
        }
        raw.push((index, parts, file.is_dir(), mode));
    }

    if metadata_paths.len() != 1 || metadata_paths[0].len() > 2 {
        return Err(invalid_package(
            "ZIP must contain one root or single-folder SKILL.md",
        ));
    }
    let wrapper = if metadata_paths[0].len() == 2 {
        Some(metadata_paths[0][0].as_str())
    } else {
        None
    };

    let mut entries = Vec::with_capacity(raw.len());
    for (index, parts, directory, mode) in raw {
        let relative = match wrapper {
            Some(wrapper) if parts.first().is_some_and(|part| part == wrapper) => &parts[1..],
            Some(_) => {
                return Err(invalid_package(
                    "ZIP contains files outside the skill folder",
                ))
            }
            None => &parts[..],
        };
        if relative.is_empty() {
            if !directory {
                return Err(invalid_package("invalid skill folder"));
            }
            continue;
        }
        if relative.len() == 1 && relative[0].eq_ignore_ascii_case(VERSION_FILE_NAME) {
            return Err(invalid_package("reserved skill version file"));
        }
        entries.push(Entry {
            index,
            path: relative.iter().collect(),
            directory,
            mode,
        });
    }
    Ok(entries)
}

fn extract(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    entries: &[Entry],
    staging: &Path,
) -> Result<(), String> {
    let mut total = 0_u64;
    for entry in entries {
        let path = staging.join(&entry.path);
        if entry.directory {
            fs::create_dir_all(&path).map_err(install_error)?;
            continue;
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(install_error)?;
        }
        let mut file = archive
            .by_index(entry.index)
            .map_err(|error| invalid_package(&format!("invalid ZIP entry: {error}")))?;
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(install_error)?;
        let written = io::copy(&mut file.by_ref().take(MAX_ENTRY_BYTES + 1), &mut output)
            .map_err(|error| invalid_package(&format!("cannot extract ZIP entry: {error}")))?;
        total += written;
        if written > MAX_ENTRY_BYTES || total > MAX_EXTRACTED_BYTES {
            return Err(invalid_package("extracted ZIP is too large"));
        }
    }
    Ok(())
}

fn validate_metadata(name: &str, bytes: &[u8]) -> Result<(), String> {
    let content =
        std::str::from_utf8(bytes).map_err(|_| invalid_package("SKILL.md must be UTF-8"))?;
    let mut lines = content.lines();
    if lines.next() != Some("---") {
        return Err(invalid_package("SKILL.md is missing frontmatter"));
    }
    let mut frontmatter = String::new();
    let mut closed = false;
    for line in lines {
        if line == "---" {
            closed = true;
            break;
        }
        frontmatter.push_str(line);
        frontmatter.push('\n');
    }
    if !closed {
        return Err(invalid_package("SKILL.md is missing frontmatter"));
    }
    let metadata: Value = serde_yaml::from_str(&frontmatter)
        .map_err(|error| invalid_package(&format!("invalid frontmatter: {error}")))?;
    let fields = metadata
        .as_mapping()
        .ok_or_else(|| invalid_package("frontmatter must be an object"))?;
    if fields.get("name").and_then(Value::as_str) != Some(name) {
        return Err(invalid_package(
            "SKILL.md name does not match the requested skill",
        ));
    }
    if fields
        .get("description")
        .and_then(Value::as_str)
        .is_none_or(|description| description.trim().is_empty())
    {
        return Err(invalid_package("SKILL.md requires a description"));
    }
    for legacy in ["disableModelInvocation", "modelInvocable", "userInvocable"] {
        if fields.contains_key(legacy) {
            return Err(invalid_package("unsupported invocation field"));
        }
    }
    for key in ["disable-model-invocation", "user-invocable"] {
        if let Some(value) = fields.get(key) {
            let enabled = policy_boolean(value)
                .ok_or_else(|| invalid_package("invalid invocation policy"))?;
            if key == "user-invocable" && !enabled {
                return Err("SKILL_NOT_USER_INVOCABLE: skill disables command invocation".into());
            }
        }
    }
    Ok(())
}

fn policy_boolean(value: &Value) -> Option<bool> {
    if let Some(value) = value.as_bool() {
        return Some(value);
    }
    if let Some(value) = value.as_i64() {
        return match value {
            0 => Some(false),
            1 => Some(true),
            _ => None,
        };
    }
    match value.as_str()?.to_ascii_lowercase().as_str() {
        "true" | "yes" | "on" | "1" => Some(true),
        "false" | "no" | "off" | "0" => Some(false),
        _ => None,
    }
}

fn commit(
    home: &Path,
    name: &str,
    staging: &Path,
    entries: &[Entry],
    version: Option<&str>,
) -> Result<(), String> {
    let root = home.join("skills");
    fs::create_dir_all(&root).map_err(install_error)?;
    let target = root.join(name);
    match fs::create_dir(&target) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            return Err(format!("SKILL_ALREADY_EXISTS: {name}"));
        }
        Err(error) => return Err(install_error(error)),
    }

    let mut directories = vec![target.clone()];
    let mut files = Vec::new();
    let result = (|| {
        if let Some(version) = version {
            let path = target.join(VERSION_FILE_NAME);
            let bytes =
                serde_json::to_vec(&serde_json::json!({ "source": "nacos", "version": version }))
                    .map_err(|error| format!("SKILL_INSTALL_FAILED: {error}"))?;
            let mut output = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .map_err(install_error)?;
            files.push(path);
            output.write_all(&bytes).map_err(install_error)?;
        }
        let mut ordered: Vec<&Entry> = entries.iter().collect();
        ordered.sort_by_key(|entry| entry.path == Path::new("SKILL.md"));
        for entry in ordered {
            let parent = if entry.directory {
                entry.path.as_path()
            } else {
                entry.path.parent().unwrap_or_else(|| Path::new(""))
            };
            let mut directory = target.clone();
            for component in parent.components() {
                directory.push(component);
                if !directories.contains(&directory) {
                    fs::create_dir(&directory).map_err(install_error)?;
                    directories.push(directory.clone());
                }
            }
            if entry.directory {
                continue;
            }
            let path = target.join(&entry.path);
            let mut source = File::open(staging.join(&entry.path)).map_err(install_error)?;
            let mut output = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .map_err(install_error)?;
            files.push(path.clone());
            io::copy(&mut source, &mut output).map_err(install_error)?;
            #[cfg(unix)]
            if let Some(mode) = entry.mode {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&path, fs::Permissions::from_mode(mode & 0o777))
                    .map_err(install_error)?;
            }
            #[cfg(not(unix))]
            let _ = entry.mode;
        }
        Ok(())
    })();

    if let Err(error) = result {
        let mut cleanup_errors = Vec::new();
        for file in files.iter().rev() {
            if let Err(cleanup) = fs::remove_file(file) {
                cleanup_errors.push(cleanup.to_string());
            }
        }
        for directory in directories.iter().rev() {
            if let Err(cleanup) = fs::remove_dir(directory) {
                cleanup_errors.push(cleanup.to_string());
            }
        }
        if !cleanup_errors.is_empty() {
            return Err(format!(
                "{error}; cleanup failed: {}",
                cleanup_errors.join(", ")
            ));
        }
        return Err(error);
    }
    Ok(())
}

fn lock_skills(home: &Path) -> Result<File, String> {
    let root = home.join("skills");
    fs::create_dir_all(&root).map_err(install_error)?;
    let path = root.join(LOCK_FILE_NAME);
    match fs::symlink_metadata(&path) {
        Ok(metadata) if !metadata.is_file() || is_link(&metadata) => {
            return Err("SKILL_INSTALL_FAILED: unsafe skill lock".into())
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(install_error(error)),
    }
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
        .map_err(install_error)?;
    let deadline = Instant::now() + LOCK_TIMEOUT;
    loop {
        match file.try_lock() {
            Ok(()) => return Ok(file),
            Err(fs::TryLockError::WouldBlock) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(fs::TryLockError::WouldBlock) => {
                return Err("SKILL_OPERATION_BUSY: another skill operation is in progress".into())
            }
            Err(fs::TryLockError::Error(error)) => return Err(install_error(error)),
        }
    }
}

fn installed_version(target: &Path) -> Result<Option<String>, String> {
    let path = target.join(VERSION_FILE_NAME);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(install_error(error)),
    };
    if !metadata.is_file() || is_link(&metadata) || metadata.len() > MAX_VERSION_FILE_BYTES {
        return Err("SKILL_VERSION_METADATA_INVALID: invalid version record".into());
    }
    let bytes = fs::read(path).map_err(install_error)?;
    let value: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|_| "SKILL_VERSION_METADATA_INVALID: invalid version record")?;
    let version = value
        .get("version")
        .and_then(serde_json::Value::as_str)
        .ok_or("SKILL_VERSION_METADATA_INVALID: invalid version record")?;
    if value.get("source").and_then(serde_json::Value::as_str) != Some("nacos")
        || validate_version(version).is_err()
    {
        return Err("SKILL_VERSION_METADATA_INVALID: invalid version record".into());
    }
    Ok(Some(version.to_string()))
}

fn is_link(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        return metadata.file_attributes() & 0x400 != 0;
    }
    #[cfg(not(windows))]
    false
}

fn replace(
    home: &Path,
    name: &str,
    staging: &Path,
    install: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let target = home.join("skills").join(name);
    let backup = staging.join("backup");
    fs::rename(&target, &backup).map_err(install_error)?;
    if let Err(error) = install() {
        match fs::symlink_metadata(&target) {
            Ok(_) => {
                return Err(format!(
                    "SKILL_UPDATE_ROLLBACK_FAILED: {error}; target is occupied"
                ))
            }
            Err(check) if check.kind() == io::ErrorKind::NotFound => {}
            Err(check) => return Err(format!("SKILL_UPDATE_ROLLBACK_FAILED: {error}; {check}")),
        }
        if let Err(restore) = fs::rename(&backup, &target) {
            return Err(format!("SKILL_UPDATE_ROLLBACK_FAILED: {error}; {restore}"));
        }
        return Err(error);
    }
    fs::remove_dir_all(backup)
        .map_err(|error| format!("SKILL_UPDATE_CLEANUP_FAILED: update completed; {error}"))?;
    Ok(())
}

fn update_target_error(error: io::Error) -> String {
    if error.kind() == io::ErrorKind::NotFound {
        "SKILL_UPDATE_UNAVAILABLE: skill does not exist".into()
    } else {
        install_error(error)
    }
}

fn invalid_package(message: &str) -> String {
    format!("SKILL_PACKAGE_INVALID: {message}")
}

fn install_error(error: io::Error) -> String {
    format!("SKILL_INSTALL_FAILED: {error}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::FileOptions;

    fn archive(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (path, content) in files {
            if path.ends_with('/') {
                writer.add_directory(*path, FileOptions::default()).unwrap();
            } else {
                writer.start_file(*path, FileOptions::default()).unwrap();
                writer.write_all(content).unwrap();
            }
        }
        writer.finish().unwrap().into_inner()
    }

    fn metadata(name: &str) -> Vec<u8> {
        format!("---\nname: {name}\ndescription: Example skill\n---\nUse this skill.\n")
            .into_bytes()
    }

    #[test]
    fn installs_root_bundle_with_resources_in_the_kernel_skill_directory() {
        let home = tempfile::tempdir().unwrap();
        let skill = metadata("demo");
        let bytes = archive(&[
            ("SKILL.md", &skill),
            ("scripts/run.sh", b"echo ready"),
            ("references/guide.md", b"guide"),
        ]);
        install(home.path(), "demo", &bytes, None).unwrap();
        let target = home.path().join("skills").join("demo");
        assert_eq!(fs::read(target.join("SKILL.md")).unwrap(), skill);
        assert_eq!(
            fs::read(target.join("scripts").join("run.sh")).unwrap(),
            b"echo ready"
        );
        assert_eq!(
            fs::read(target.join("references").join("guide.md")).unwrap(),
            b"guide"
        );
        assert_eq!(fs::read_dir(home.path()).unwrap().count(), 1);
    }

    #[test]
    fn unwraps_single_folder_bundles_without_losing_resources() {
        let home = tempfile::tempdir().unwrap();
        let skill = metadata("demo");
        let bytes = archive(&[
            ("package/", b""),
            ("package/SKILL.md", &skill),
            ("package/data/example.txt", b"example"),
        ]);
        install(home.path(), "demo", &bytes, None).unwrap();
        let target = home.path().join("skills").join("demo");
        assert_eq!(fs::read(target.join("SKILL.md")).unwrap(), skill);
        assert_eq!(
            fs::read(target.join("data").join("example.txt")).unwrap(),
            b"example"
        );
        assert!(!target.join("package").exists());
    }

    #[test]
    fn existing_directory_or_flat_skill_is_never_overwritten() {
        for flat in [false, true] {
            let home = tempfile::tempdir().unwrap();
            let root = home.path().join("skills");
            fs::create_dir_all(&root).unwrap();
            let original = if flat {
                root.join("demo.md")
            } else {
                let directory = root.join("demo");
                fs::create_dir(&directory).unwrap();
                directory.join("SKILL.md")
            };
            fs::write(&original, b"user content").unwrap();
            let bytes = archive(&[("SKILL.md", &metadata("demo"))]);
            assert_eq!(
                install(home.path(), "demo", &bytes, None).unwrap_err(),
                "SKILL_ALREADY_EXISTS: demo"
            );
            assert_eq!(fs::read(original).unwrap(), b"user content");
        }
    }

    #[test]
    fn records_the_version_returned_with_a_downloaded_package() {
        let home = tempfile::tempdir().unwrap();
        let bytes = archive(&[("SKILL.md", &metadata("demo"))]);

        install(home.path(), "demo", &bytes, Some("1.2.3")).unwrap();

        let target = home.path().join("skills").join("demo");
        assert_eq!(
            installed_version(&target).unwrap().as_deref(),
            Some("1.2.3")
        );
    }

    #[test]
    fn updates_the_skill_and_removes_obsolete_files() {
        let home = tempfile::tempdir().unwrap();
        let old = archive(&[("SKILL.md", &metadata("demo")), ("old.txt", b"old")]);
        let new = archive(&[("SKILL.md", &metadata("demo")), ("new.txt", b"new")]);
        install(home.path(), "demo", &old, Some("1.0.0")).unwrap();

        update(home.path(), "demo", &new, "1.1.0", Some("1.0.0")).unwrap();

        let target = home.path().join("skills").join("demo");
        assert!(!target.join("old.txt").exists());
        assert_eq!(fs::read(target.join("new.txt")).unwrap(), b"new");
        assert_eq!(
            installed_version(&target).unwrap().as_deref(),
            Some("1.1.0")
        );
    }

    #[test]
    fn confirmed_legacy_update_records_the_downloaded_version() {
        let home = tempfile::tempdir().unwrap();
        let old = archive(&[("SKILL.md", &metadata("demo")), ("old.txt", b"old")]);
        let new = archive(&[("SKILL.md", &metadata("demo")), ("new.txt", b"new")]);
        install(home.path(), "demo", &old, None).unwrap();

        update(home.path(), "demo", &new, "2.0.0", None).unwrap();

        let target = home.path().join("skills").join("demo");
        assert!(!target.join("old.txt").exists());
        assert_eq!(fs::read(target.join("new.txt")).unwrap(), b"new");
        assert_eq!(
            installed_version(&target).unwrap().as_deref(),
            Some("2.0.0")
        );
    }

    #[test]
    fn invalid_update_package_and_stale_version_preserve_local_files() {
        let home = tempfile::tempdir().unwrap();
        let old = archive(&[("SKILL.md", &metadata("demo")), ("old.txt", b"old")]);
        install(home.path(), "demo", &old, Some("1.0.0")).unwrap();
        let invalid = archive(&[("SKILL.md", &metadata("another"))]);

        assert!(
            update(home.path(), "demo", &invalid, "1.1.0", Some("1.0.0"))
                .unwrap_err()
                .starts_with("SKILL_PACKAGE_INVALID:")
        );
        assert!(update(home.path(), "demo", &old, "1.1.0", Some("0.9.0"))
            .unwrap_err()
            .starts_with("SKILL_VERSION_CHANGED:"));
        assert!(update(home.path(), "demo", &old, "1.0.0", Some("1.0.0"))
            .unwrap_err()
            .starts_with("SKILL_VERSION_INVALID:"));
        let target = home.path().join("skills").join("demo");
        assert_eq!(fs::read(target.join("old.txt")).unwrap(), b"old");
        assert_eq!(
            installed_version(&target).unwrap().as_deref(),
            Some("1.0.0")
        );
    }

    #[test]
    fn update_uses_semantic_version_precedence_including_prereleases() {
        let home = tempfile::tempdir().unwrap();
        let old = archive(&[("SKILL.md", &metadata("demo")), ("old.txt", b"old")]);
        let new = archive(&[("SKILL.md", &metadata("demo")), ("new.txt", b"new")]);
        install(home.path(), "demo", &old, Some("1.10.0")).unwrap();

        assert!(update(home.path(), "demo", &new, "1.2.0", Some("1.10.0"))
            .unwrap_err()
            .starts_with("SKILL_VERSION_INVALID:"));
        let target = home.path().join("skills").join("demo");
        assert_eq!(fs::read(target.join("old.txt")).unwrap(), b"old");

        let prerelease_home = tempfile::tempdir().unwrap();
        install(prerelease_home.path(), "demo", &old, Some("2.0.0-rc.1")).unwrap();
        update(
            prerelease_home.path(),
            "demo",
            &new,
            "2.0.0",
            Some("2.0.0-rc.1"),
        )
        .unwrap();
        assert_eq!(
            fs::read(
                prerelease_home
                    .path()
                    .join("skills")
                    .join("demo")
                    .join("new.txt")
            )
            .unwrap(),
            b"new"
        );
    }

    #[test]
    fn rejects_flat_conflicts_and_reserved_version_files() {
        let home = tempfile::tempdir().unwrap();
        let old = archive(&[("SKILL.md", &metadata("demo")), ("old.txt", b"old")]);
        install(home.path(), "demo", &old, Some("1.0.0")).unwrap();
        let root = home.path().join("skills");
        fs::write(root.join("demo.md"), b"separate local skill").unwrap();

        assert!(update(home.path(), "demo", &old, "1.1.0", Some("1.0.0"))
            .unwrap_err()
            .starts_with("SKILL_UPDATE_UNAVAILABLE:"));
        assert_eq!(
            fs::read(root.join("demo.md")).unwrap(),
            b"separate local skill"
        );
        assert_eq!(fs::read(root.join("demo").join("old.txt")).unwrap(), b"old");

        let reserved = archive(&[
            ("SKILL.md", &metadata("another")),
            (VERSION_FILE_NAME, b"forged"),
        ]);
        assert_eq!(
            install(home.path(), "another", &reserved, Some("1.0.0")).unwrap_err(),
            "SKILL_PACKAGE_INVALID: reserved skill version file"
        );
    }

    #[test]
    fn failed_replacement_restores_the_original_directory() {
        let home = tempfile::tempdir().unwrap();
        let bytes = archive(&[("SKILL.md", &metadata("demo")), ("old.txt", b"old")]);
        install(home.path(), "demo", &bytes, Some("1.0.0")).unwrap();
        let staging = tempfile::tempdir_in(home.path()).unwrap();

        assert_eq!(
            replace(home.path(), "demo", staging.path(), || Err(
                "write failed".into()
            ))
            .unwrap_err(),
            "write failed"
        );
        assert_eq!(
            fs::read(home.path().join("skills").join("demo").join("old.txt")).unwrap(),
            b"old"
        );
        assert!(!staging.path().join("backup").exists());
    }

    #[test]
    fn failed_replacement_preserves_both_the_original_and_a_newly_created_target() {
        let home = tempfile::tempdir().unwrap();
        let bytes = archive(&[("SKILL.md", &metadata("demo")), ("old.txt", b"old")]);
        install(home.path(), "demo", &bytes, Some("1.0.0")).unwrap();
        let staging = tempfile::tempdir_in(home.path()).unwrap();
        let target = home.path().join("skills").join("demo");

        let result = replace(home.path(), "demo", staging.path(), || {
            fs::create_dir(&target).unwrap();
            fs::write(target.join("new-user-file"), b"new").unwrap();
            Err("write failed".into())
        });

        assert!(result
            .unwrap_err()
            .starts_with("SKILL_UPDATE_ROLLBACK_FAILED:"));
        assert_eq!(fs::read(target.join("new-user-file")).unwrap(), b"new");
        assert_eq!(
            fs::read(staging.path().join("backup").join("old.txt")).unwrap(),
            b"old"
        );
    }

    #[test]
    fn concurrent_updates_do_not_overwrite_a_newer_installed_version() {
        let home = tempfile::tempdir().unwrap();
        let old = archive(&[("SKILL.md", &metadata("demo")), ("old.txt", b"old")]);
        let new = archive(&[("SKILL.md", &metadata("demo")), ("new.txt", b"new")]);
        install(home.path(), "demo", &old, Some("1.0.0")).unwrap();

        let results = std::thread::scope(|scope| {
            let first = scope.spawn(|| update(home.path(), "demo", &new, "1.1.0", Some("1.0.0")));
            let second = scope.spawn(|| update(home.path(), "demo", &new, "1.1.0", Some("1.0.0")));
            [first.join().unwrap(), second.join().unwrap()]
        });

        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert!(results.iter().any(|result| result
            .as_ref()
            .is_err_and(|error| error.starts_with("SKILL_VERSION_CHANGED:")
                || error.starts_with("SKILL_UPDATE_UNAVAILABLE:"))));
        let target = home.path().join("skills").join("demo");
        assert_eq!(fs::read(target.join("new.txt")).unwrap(), b"new");
        assert_eq!(
            installed_version(&target).unwrap().as_deref(),
            Some("1.1.0")
        );
    }

    #[test]
    fn an_occupied_skill_lock_returns_an_error_without_replacing_files() {
        let home = tempfile::tempdir().unwrap();
        let old = archive(&[("SKILL.md", &metadata("demo")), ("old.txt", b"old")]);
        let new = archive(&[("SKILL.md", &metadata("demo")), ("new.txt", b"new")]);
        install(home.path(), "demo", &old, Some("1.0.0")).unwrap();
        let guard = lock_skills(home.path()).unwrap();

        assert_eq!(
            update(home.path(), "demo", &new, "1.1.0", Some("1.0.0")).unwrap_err(),
            "SKILL_OPERATION_BUSY: another skill operation is in progress"
        );
        drop(guard);
        let target = home.path().join("skills").join("demo");
        assert_eq!(fs::read(target.join("old.txt")).unwrap(), b"old");
        assert_eq!(
            installed_version(&target).unwrap().as_deref(),
            Some("1.0.0")
        );
    }

    #[test]
    fn rejects_invalid_metadata_without_installing_a_partial_skill() {
        let invalid = [
            (
                "---\nname: another\ndescription: Example\n---\nbody",
                "SKILL_PACKAGE_INVALID: SKILL.md name does not match the requested skill",
            ),
            (
                "---\nname: demo\n---\nbody",
                "SKILL_PACKAGE_INVALID: SKILL.md requires a description",
            ),
            (
                "---\nname: demo\ndescription: Example\nuser-invocable: false\n---\nbody",
                "SKILL_NOT_USER_INVOCABLE: skill disables command invocation",
            ),
            (
                "---\nname: demo\ndescription: Example\nuserInvocable: true\n---\nbody",
                "SKILL_PACKAGE_INVALID: unsupported invocation field",
            ),
            (
                "---\nname: demo\ndescription: Example\ndisable-model-invocation: maybe\n---\nbody",
                "SKILL_PACKAGE_INVALID: invalid invocation policy",
            ),
            (
                "missing frontmatter",
                "SKILL_PACKAGE_INVALID: SKILL.md is missing frontmatter",
            ),
        ];
        for (content, expected) in invalid {
            let home = tempfile::tempdir().unwrap();
            let bytes = archive(&[("SKILL.md", content.as_bytes()), ("data.txt", b"data")]);
            assert_eq!(
                install(home.path(), "demo", &bytes, None).unwrap_err(),
                expected
            );
            assert!(!home.path().join("skills").join("demo").exists());
        }
    }

    #[test]
    fn rejects_unsafe_paths_duplicate_metadata_and_mixed_layouts() {
        let skill = metadata("demo");
        for files in [
            vec![
                ("SKILL.md", skill.as_slice()),
                ("../escape", b"bad".as_slice()),
            ],
            vec![
                ("SKILL.md", skill.as_slice()),
                ("dir\\escape", b"bad".as_slice()),
            ],
            vec![
                ("SKILL.md", skill.as_slice()),
                ("other/SKILL.md", skill.as_slice()),
            ],
            vec![
                ("folder/SKILL.md", skill.as_slice()),
                ("outside.txt", b"bad".as_slice()),
            ],
            vec![
                ("SKILL.md", skill.as_slice()),
                ("DATA", b"a".as_slice()),
                ("data", b"b".as_slice()),
            ],
        ] {
            let home = tempfile::tempdir().unwrap();
            assert!(install(home.path(), "demo", &archive(&files), None)
                .unwrap_err()
                .starts_with("SKILL_PACKAGE_INVALID:"));
            assert!(!home.path().join("skills").join("demo").exists());
        }
    }

    #[test]
    fn rejects_oversized_entries_and_invalid_kernel_names() {
        let home = tempfile::tempdir().unwrap();
        let skill = metadata("demo");
        let large = vec![0; MAX_ENTRY_BYTES as usize + 1];
        let bytes = archive(&[("SKILL.md", &skill), ("large", &large)]);
        assert!(install(home.path(), "demo", &bytes, None)
            .unwrap_err()
            .starts_with("SKILL_PACKAGE_INVALID:"));
        for name in [
            "",
            "-demo",
            "demo-",
            "demo--skill",
            "../demo",
            "Demo",
            &"a".repeat(65),
        ] {
            assert_eq!(
                validate_name(name).unwrap_err(),
                "SKILL_NAME_INVALID: skill name cannot be used by the kernel",
                "{name}"
            );
        }
        assert!(validate_name("demo-123").is_ok());
        assert!(validate_name(&"a".repeat(64)).is_ok());
        assert!(!home.path().join("skills").exists());
    }

    #[test]
    fn accepts_the_entry_count_limit_and_rejects_one_more() {
        let skill = metadata("demo");
        let names: Vec<_> = (0..MAX_ENTRIES)
            .map(|index| format!("resource-{index}"))
            .collect();
        let mut files = vec![("SKILL.md", skill.as_slice())];
        files.extend(
            names
                .iter()
                .take(MAX_ENTRIES - 1)
                .map(|name| (name.as_str(), b"x".as_slice())),
        );
        let accepted = archive(&files);
        assert_eq!(
            entries(&mut ZipArchive::new(Cursor::new(accepted.as_slice())).unwrap())
                .unwrap()
                .len(),
            MAX_ENTRIES
        );

        files.push((names[MAX_ENTRIES - 1].as_str(), b"x"));
        let rejected = archive(&files);
        assert_eq!(
            entries(&mut ZipArchive::new(Cursor::new(rejected.as_slice())).unwrap())
                .err()
                .unwrap(),
            "SKILL_PACKAGE_INVALID: invalid entry count"
        );
    }

    #[test]
    fn accepts_the_extracted_size_limit_and_rejects_one_more_byte() {
        let skill = metadata("demo");
        let block = vec![0; MAX_ENTRY_BYTES as usize];
        let last = MAX_ENTRY_BYTES as usize - skill.len();
        for (last_size, accepted) in [(last, true), (last + 1, false)] {
            let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
            writer
                .start_file("SKILL.md", FileOptions::default())
                .unwrap();
            writer.write_all(&skill).unwrap();
            for index in 0..4 {
                writer
                    .start_file(
                        format!("resource-{index}"),
                        FileOptions::default().compression_method(zip::CompressionMethod::Deflated),
                    )
                    .unwrap();
                writer
                    .write_all(if index == 3 {
                        &block[..last_size]
                    } else {
                        &block
                    })
                    .unwrap();
            }
            let bytes = writer.finish().unwrap().into_inner();
            let mut zip = ZipArchive::new(Cursor::new(bytes.as_slice())).unwrap();
            let result = entries(&mut zip);
            if accepted {
                assert_eq!(result.unwrap().len(), 5);
            } else {
                assert_eq!(
                    result.err().unwrap(),
                    "SKILL_PACKAGE_INVALID: ZIP is too large"
                );
            }
        }
    }

    #[test]
    fn concurrent_installations_do_not_replace_the_winner() {
        let home = tempfile::tempdir().unwrap();
        let bytes = archive(&[("SKILL.md", &metadata("demo")), ("data.txt", b"data")]);
        let results = std::thread::scope(|scope| {
            let first = scope.spawn(|| install(home.path(), "demo", &bytes, None));
            let second = scope.spawn(|| install(home.path(), "demo", &bytes, None));
            [first.join().unwrap(), second.join().unwrap()]
        });
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert!(results.iter().any(|result| {
            result
                .as_ref()
                .is_err_and(|error| error == "SKILL_ALREADY_EXISTS: demo")
        }));
        assert_eq!(
            fs::read(home.path().join("skills").join("demo").join("data.txt")).unwrap(),
            b"data"
        );
    }
}
