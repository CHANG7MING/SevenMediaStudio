use serde::Serialize;
use std::{
  net::TcpStream,
  process::{Child, Command, Stdio},
  sync::Mutex,
  thread,
  time::{Duration, Instant},
};
use tauri::{Manager, RunEvent};

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

struct ServerProcess(Mutex<Option<Child>>);

const SERVER_PORT: u16 = 47831;

fn start_production_server(app: &tauri::AppHandle) -> Result<Child, Box<dyn std::error::Error>> {
  let resource_dir = app.path().resource_dir()?;
  let server_dir = resource_dir.join("server");
  let node = resource_dir.join("runtime/node");
  let ffmpeg = resource_dir.join("runtime/ffmpeg");
  let ffprobe = resource_dir.join("runtime/ffprobe");

  let child = Command::new(node)
    .arg(server_dir.join("server.js"))
    .current_dir(&server_dir)
    .env("HOSTNAME", "127.0.0.1")
    .env("PORT", SERVER_PORT.to_string())
    .env("NODE_ENV", "production")
    .env("FFMPEG_PATH", ffmpeg)
    .env("FFPROBE_PATH", ffprobe)
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .spawn()?;

  let deadline = Instant::now() + Duration::from_secs(15);
  while Instant::now() < deadline {
    if TcpStream::connect(("127.0.0.1", SERVER_PORT)).is_ok() {
      return Ok(child);
    }
    thread::sleep(Duration::from_millis(100));
  }
  let mut child = child;
  let _ = child.kill();
  Err("内置 Next 服务启动超时".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let mut builder = tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![app_info])
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init());

  builder = builder.setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
          .build(),
        )?;
      } else {
        let child = start_production_server(app.handle())?;
        app.manage(ServerProcess(Mutex::new(Some(child))));
        if let Some(window) = app.get_webview_window("main") {
          window.navigate(format!("http://127.0.0.1:{SERVER_PORT}").parse()?)?;
        }
      }
      Ok(())
    });

  builder
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app, event| {
      if let RunEvent::ExitRequested { .. } = event {
        if let Some(state) = app.try_state::<ServerProcess>() {
          if let Ok(mut process) = state.0.lock() {
            if let Some(child) = process.as_mut() {
              let _ = child.kill();
            }
          }
        }
      }
    });
}
