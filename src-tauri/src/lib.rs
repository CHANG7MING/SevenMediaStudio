use serde::Serialize;

#[derive(Debug, Serialize)]
struct AppInfo {
  arch: &'static str,
  os: &'static str,
}

#[tauri::command]
fn app_info() -> AppInfo {
  AppInfo {
    arch: std::env::consts::ARCH,
    os: std::env::consts::OS,
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![app_info])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
