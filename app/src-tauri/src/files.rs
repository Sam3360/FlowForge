//! Workflow file I/O. Writes are atomic: temp file in the same folder, fsync, then rename over the target.

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const MAX_WORKFLOW_BYTES: u64 = 16 * 1024 * 1024;

fn check_json_path(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    let ok = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("json"))
        .unwrap_or(false);
    if !ok {
        return Err("Only .json workflow files can be opened or saved".into());
    }
    Ok(p)
}

fn atomic_write(target: &Path, text: &str) -> Result<(), String> {
    let dir = target.parent().ok_or("The file path has no folder")?;
    let name = target.file_name().and_then(|n| n.to_str()).unwrap_or("workflow");
    let tmp = dir.join(format!(".{name}.tmp-{}", std::process::id()));
    let result = (|| -> std::io::Result<()> {
        let mut f = File::create(&tmp)?;
        f.write_all(text.as_bytes())?;
        f.sync_all()?;
        fs::rename(&tmp, target) // replaces the target atomically on Windows (MoveFileEx) and POSIX
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp);
        return Err(format!("Could not write {}: {e}", target.display()));
    }
    Ok(())
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    let p = check_json_path(&path)?;
    let meta = fs::metadata(&p).map_err(|e| format!("Could not read {path}: {e}"))?;
    if meta.len() > MAX_WORKFLOW_BYTES {
        return Err("That file is too large to be a workflow".into());
    }
    fs::read_to_string(&p).map_err(|e| format!("Could not read {path}: {e}"))
}

#[tauri::command]
pub fn write_text_atomic(path: String, text: String) -> Result<(), String> {
    let p = check_json_path(&path)?;
    atomic_write(&p, &text)
}

fn recovery_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("recovery.json"))
}

#[tauri::command]
pub fn write_recovery(app: AppHandle, text: String) -> Result<(), String> {
    atomic_write(&recovery_path(&app)?, &text)
}

#[tauri::command]
pub fn read_recovery(app: AppHandle) -> Result<Option<String>, String> {
    let p = recovery_path(&app)?;
    if !p.exists() {
        return Ok(None);
    }
    fs::read_to_string(p).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_recovery(app: AppHandle) -> Result<(), String> {
    let p = recovery_path(&app)?;
    if p.exists() {
        fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}
