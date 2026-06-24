use std::fs;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, Manager, State};

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Falha ao ler '{}': {}", path, e))
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| format!("Falha ao salvar '{}': {}", path, e))
}

/// Read any file as base64 (used to load XLSX into SheetJS).
#[tauri::command]
fn read_file_base64(path: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = fs::read(&path).map_err(|e| format!("Falha ao ler '{}': {}", path, e))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Write a base64 payload to disk as binary (used to save XLSX from SheetJS).
#[tauri::command]
fn write_file_base64(path: String, base64_data: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data.as_bytes())
        .map_err(|e| format!("base64 inválido: {}", e))?;
    fs::write(&path, bytes).map_err(|e| format!("Falha ao salvar '{}': {}", path, e))
}

// ---------------------------------------------------------------------------
// Local AI: llama-server lifecycle
// ---------------------------------------------------------------------------

#[derive(Default)]
struct LlmState {
    child: Option<Child>,
    port: u16,
    model: String,
}

#[derive(serde::Serialize)]
struct ModelInfo {
    name: String,
    path: String,
    size_gb: f64,
    is_projector: bool,
}

#[derive(serde::Serialize)]
struct LlmStatus {
    running: bool,
    port: u16,
    model: String,
}

fn collect_gguf(dir: &Path, base: &Path, out: &mut Vec<ModelInfo>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_gguf(&path, base, out);
        } else if path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("gguf"))
            .unwrap_or(false)
        {
            let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            out.push(ModelInfo {
                name: path.strip_prefix(base).unwrap_or(&path).to_string_lossy().to_string(),
                path: path.to_string_lossy().to_string(),
                size_gb: (size as f64) / 1_000_000_000.0,
                is_projector: file_name.to_lowercase().starts_with("mmproj"),
            });
        }
    }
}

#[tauri::command]
fn list_models(dir: String) -> Result<Vec<ModelInfo>, String> {
    let base = PathBuf::from(&dir);
    if !base.exists() {
        return Err(format!("Pasta de modelos não encontrada: {}", dir));
    }
    let mut out = Vec::new();
    collect_gguf(&base, &base, &mut out);
    out.sort_by(|a, b| a.size_gb.partial_cmp(&b.size_gb).unwrap_or(std::cmp::Ordering::Equal));
    Ok(out)
}

const LLAMA_SERVER_BIN: &str = if cfg!(windows) { "llama-server.exe" } else { "llama-server" };

fn resolve_llama_server(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let rel = format!("binaries/llama/{}", LLAMA_SERVER_BIN);
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join(&rel));
    }
    if let Ok(res) = app.path().resource_dir() {
        candidates.push(res.join(&rel));
        candidates.push(res.join(format!("llama/{}", LLAMA_SERVER_BIN)));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(&rel));
            candidates.push(dir.join(format!("llama/{}", LLAMA_SERVER_BIN)));
        }
    }
    for c in candidates {
        if c.exists() {
            return Ok(c);
        }
    }
    Err("llama-server não encontrado (runtime de IA ausente)".into())
}

fn wait_for_port(port: u16, secs: u64) -> Result<(), String> {
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    for _ in 0..(secs * 4) {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    Err("llama-server não respondeu a tempo".into())
}

#[tauri::command]
fn start_llm(
    app: tauri::AppHandle,
    state: State<'_, Mutex<LlmState>>,
    model_path: String,
    n_gpu_layers: i32,
    ctx_size: u32,
) -> Result<u16, String> {
    {
        let mut s = state.lock().map_err(|_| "estado da IA corrompido")?;
        if let Some(child) = s.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
        s.child = None;
    }

    let exe = resolve_llama_server(&app)?;
    let dir = exe.parent().ok_or("diretório do llama inválido")?.to_path_buf();
    let port: u16 = 8099;

    let mut cmd = Command::new(&exe);
    cmd.current_dir(&dir).args([
        "--model",
        &model_path,
        "--host",
        "127.0.0.1",
        "--port",
        &port.to_string(),
        "-ngl",
        &n_gpu_layers.to_string(),
        "-c",
        &ctx_size.to_string(),
        "--no-webui",
    ]);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }

    let child = cmd.spawn().map_err(|e| format!("falha ao iniciar llama-server: {}", e))?;
    {
        let mut s = state.lock().map_err(|_| "estado da IA corrompido")?;
        s.child = Some(child);
        s.port = port;
        s.model = model_path;
    }
    wait_for_port(port, 180)?;
    Ok(port)
}

#[tauri::command]
fn stop_llm(state: State<'_, Mutex<LlmState>>) -> Result<(), String> {
    let mut s = state.lock().map_err(|_| "estado da IA corrompido")?;
    if let Some(child) = s.child.as_mut() {
        let _ = child.kill();
        let _ = child.wait();
    }
    s.child = None;
    s.model.clear();
    Ok(())
}

#[tauri::command]
fn llm_status(state: State<'_, Mutex<LlmState>>) -> LlmStatus {
    let mut s = state.lock().expect("estado da IA");
    let running = match s.child.as_mut() {
        Some(child) => matches!(child.try_wait(), Ok(None)),
        None => false,
    };
    LlmStatus { running, port: s.port, model: s.model.clone() }
}

#[tauri::command]
fn get_startup_file() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|a| !a.starts_with('-') && Path::new(a).is_file())
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(file) = argv.iter().skip(1).find(|a| Path::new(a).is_file()) {
                let _ = app.emit("open-file", file.clone());
            }
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(LlmState::default()))
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("close-requested", ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            write_text_file,
            read_file_base64,
            write_file_base64,
            list_models,
            start_llm,
            stop_llm,
            llm_status,
            get_startup_file,
            exit_app
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<Mutex<LlmState>>() {
                    if let Ok(mut s) = state.lock() {
                        if let Some(child) = s.child.as_mut() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        });
}
