//! Launches the Python engine as a Tauri sidecar and relays its NDJSON stdout to the webview.
//! stdout is protocol-only; stderr is logged. See docs/PROTOCOL.md.

use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Must match engine MAX_MESSAGE_BYTES (4 MiB) with some slack; a longer unterminated line is dropped.
const MAX_BUFFER: usize = 8 * 1024 * 1024;

#[derive(Default)]
pub struct EngineState {
    child: Mutex<Option<CommandChild>>,
}

pub fn kill(state: &EngineState) {
    if let Some(child) = state.child.lock().unwrap().take() {
        let _ = child.kill();
    }
}

#[tauri::command]
pub async fn engine_start(app: AppHandle, state: State<'_, EngineState>) -> Result<(), String> {
    if state.child.lock().unwrap().is_some() {
        return Ok(());
    }
    let command = app
        .shell()
        .sidecar("flowforge-engine")
        .map_err(|e| format!("The engine executable is missing or invalid: {e}"))?;
    let (mut rx, child) = command
        .spawn()
        .map_err(|e| format!("Could not start the engine: {e}"))?;
    *state.child.lock().unwrap() = Some(child);

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut buf: Vec<u8> = Vec::new();
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    buf.extend_from_slice(&bytes);
                    while let Some(pos) = buf.iter().position(|b| *b == b'\n') {
                        let line: Vec<u8> = buf.drain(..=pos).collect();
                        let text = String::from_utf8_lossy(&line[..line.len() - 1])
                            .trim_end_matches('\r')
                            .to_string();
                        if !text.is_empty() {
                            let _ = handle.emit("engine-line", text);
                        }
                    }
                    if buf.len() > MAX_BUFFER {
                        buf.clear(); // oversize unterminated line: drop it rather than grow without bound
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    eprintln!("[engine] {}", String::from_utf8_lossy(&bytes).trim_end());
                }
                CommandEvent::Error(message) => {
                    let _ = handle.emit("engine-exit", message);
                }
                CommandEvent::Terminated(payload) => {
                    if let Some(state) = handle.try_state::<EngineState>() {
                        *state.child.lock().unwrap() = None;
                    }
                    let _ = handle.emit("engine-exit", format!("exit code {:?}", payload.code));
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn engine_send(line: String, state: State<'_, EngineState>) -> Result<(), String> {
    let mut guard = state.child.lock().unwrap();
    match guard.as_mut() {
        Some(child) => child
            .write(format!("{line}\n").as_bytes())
            .map_err(|e| format!("Could not write to the engine: {e}")),
        None => Err("The engine is not running".into()),
    }
}

#[tauri::command]
pub async fn engine_stop(state: State<'_, EngineState>) -> Result<(), String> {
    kill(&state);
    Ok(())
}
