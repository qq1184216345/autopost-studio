// autopost-studio 桌面壳：内置 node 跑后端；release 从用户可写 live 目录运行(支持热更新)；关窗杀进程。
#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const PORT: u16 = 8787;

struct ServerProc(Mutex<Option<Child>>);

// 只读底座目录（含 node 二进制 + 代码 + seed.mjs）。release=资源 app/；dev=源码根。
fn bundle_dir(app: &AppHandle) -> PathBuf {
    if let Ok(p) = std::env::var("APS_ROOT") {
        return PathBuf::from(p);
    }
    #[cfg(not(debug_assertions))]
    {
        if let Ok(res) = app.path().resource_dir() {
            let b = res.join("app");
            if b.join("server.mjs").exists() {
                return b;
            }
        }
    }
    let _ = app;
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf()
}

// 后端实际运行目录：release=用户可写 app_data/app（可被热更新覆盖）；dev=源码根。
fn live_dir(app: &AppHandle, bundled: bool) -> PathBuf {
    if !bundled {
        return bundle_dir(app);
    }
    app.path()
        .app_data_dir()
        .map(|d| d.join("app"))
        .unwrap_or_else(|_| bundle_dir(app))
}

fn wait_port(port: u16) {
    for _ in 0..160 {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
}

// 启动后端：release 先播种(bundle→live)，再用内置 node 从 live 跑；dev 用系统 node 从源码跑。
fn spawn_backend(app: &AppHandle) -> Child {
    let bundle = bundle_dir(app);
    let bundled = bundle.join("node").exists();
    let node: String = if bundled {
        bundle.join("node").to_string_lossy().to_string()
    } else {
        "node".to_string()
    };
    let run_dir = live_dir(app, bundled);

    if bundled {
        // 播种 live 目录（按版本比对，秒级 no-op）
        let _ = Command::new(&node)
            .arg(bundle.join("seed.mjs"))
            .arg(&run_dir)
            .status();
    }

    let mut cmd = Command::new(&node);
    cmd.arg("server.mjs")
        .current_dir(&run_dir)
        .env("PORT", PORT.to_string());
    if bundled {
        cmd.env("APS_BUNDLED", "1");
        if let Ok(data) = app.path().app_data_dir() {
            let _ = std::fs::create_dir_all(data.join("data"));
            let _ = std::fs::create_dir_all(data.join("uploads"));
            cmd.env("APS_DATA_DIR", data.join("data"));
            cmd.env("APS_UPLOADS_DIR", data.join("uploads"));
        }
    }
    cmd.spawn().expect("无法启动后端（node server.mjs）")
}

// 热更新后重启后端：杀旧进程→重启→等端口→重载窗口（加载新代码）。
#[tauri::command]
fn restart_backend(app: AppHandle) -> Result<(), String> {
    if let Some(mut c) = app.state::<ServerProc>().0.lock().unwrap().take() {
        let _ = c.kill();
        let _ = c.wait();
    }
    std::thread::sleep(Duration::from_millis(500));
    let child = spawn_backend(&app);
    app.state::<ServerProc>().0.lock().unwrap().replace(child);
    wait_port(PORT);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval("location.reload()");
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(ServerProc(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![restart_backend])
        .setup(|app| {
            let handle = app.handle().clone();
            let child = spawn_backend(&handle);
            app.state::<ServerProc>().0.lock().unwrap().replace(child);

            wait_port(PORT);
            let url = WebviewUrl::External(format!("http://127.0.0.1:{PORT}").parse().unwrap());
            WebviewWindowBuilder::new(app, "main", url)
                .title("autopost-studio")
                .inner_size(1280.0, 860.0)
                .min_inner_size(900.0, 600.0)
                .build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.app_handle().try_state::<ServerProc>() {
                    if let Some(mut child) = state.0.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("运行 Tauri 失败");
}
