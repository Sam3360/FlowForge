mod engine;
mod files;

use tauri::{Manager, RunEvent};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(engine::EngineState::default())
        .invoke_handler(tauri::generate_handler![
            engine::engine_start,
            engine::engine_send,
            engine::engine_stop,
            files::read_text_file,
            files::write_text_atomic,
            files::write_recovery,
            files::read_recovery,
            files::clear_recovery,
        ])
        .build(tauri::generate_context!())
        .expect("error while building the application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                // Never leave the engine running after the app closes.
                if let Some(state) = app.try_state::<engine::EngineState>() {
                    engine::kill(&state);
                }
            }
        });
}
