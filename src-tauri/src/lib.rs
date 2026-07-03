mod devices;
mod error;
mod export;
mod ffmpeg;
mod media;
mod recording;

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use devices::DeviceList;
use error::AppResult;
use export::{ExportProject, ExportSettings};
use media::MediaInfo;
use recording::RecordingConfig;

#[tauri::command]
async fn ffmpeg_status(app: AppHandle) -> AppResult<ffmpeg::FfmpegStatus> {
    match ffmpeg::get() {
        Ok(p) => {
            let ver = ffmpeg::runner::probe_version(&p.ffmpeg).await.unwrap_or_else(|_| "unknown".into());
            Ok(ffmpeg::FfmpegStatus::Resolved { version: ver, paths: p.clone() })
        }
        Err(_) => Ok(ffmpeg::FfmpegStatus::Failed { error: "not resolved yet".into() }),
    }
}

#[tauri::command]
async fn ensure_ffmpeg(app: AppHandle) -> AppResult<ffmpeg::FfmpegPaths> {
    ffmpeg::ensure_ffmpeg(&app).await
}

#[tauri::command]
async fn list_devices() -> AppResult<DeviceList> {
    devices::enumerate_devices().await
}

#[tauri::command]
async fn start_recording(app: AppHandle, config: RecordingConfig) -> AppResult<String> {
    recording::start_session(&app, config).await
}

#[tauri::command]
async fn stop_recording(app: AppHandle, session_id: String) -> AppResult<recording::SessionManifest> {
    recording::stop_session(&app, &session_id).await
}

#[tauri::command]
async fn pause_recording(app: AppHandle, session_id: String) -> AppResult<()> {
    recording::pause_session(&app, &session_id).await
}

#[tauri::command]
async fn resume_recording(app: AppHandle, session_id: String) -> AppResult<()> {
    recording::resume_session(&app, &session_id).await
}

#[tauri::command]
async fn save_recording_to(folder: String, dest: String) -> AppResult<Vec<String>> {
    let written = recording::save_session_to(&PathBuf::from(&folder), &PathBuf::from(&dest))?;
    Ok(written.into_iter().map(|p| p.to_string_lossy().into()).collect())
}

#[tauri::command]
async fn list_recent_sessions(app: AppHandle) -> AppResult<Vec<recording::SessionManifest>> {
    recording::list_recent_sessions(&app).await
}

#[tauri::command]
async fn load_session(folder: String) -> AppResult<recording::SessionManifest> {
    let path = PathBuf::from(&folder).join("session.json");
    let data = std::fs::read(&path).map_err(error::AppError::Io)?;
    let m: recording::SessionManifest = serde_json::from_slice(&data)?;
    Ok(m)
}

#[tauri::command]
async fn probe_media(path: String) -> AppResult<MediaInfo> {
    media::probe_file(&PathBuf::from(&path)).await
}

#[tauri::command]
async fn gen_thumbnail(path: String, time: f64, out: String) -> AppResult<()> {
    media::generate_thumbnail(&PathBuf::from(&path), time, &PathBuf::from(&out)).await
}

#[tauri::command]
async fn gen_thumbnails(path: String, count: u32, dir: String) -> AppResult<Vec<String>> {
    let v = media::generate_thumbnails(&PathBuf::from(&path), count, &PathBuf::from(&dir)).await?;
    Ok(v.into_iter().map(|p| p.to_string_lossy().into()).collect())
}

#[tauri::command]
async fn grab_screen_frame(app: AppHandle, screen_id: String, x: i32, y: i32, width: u32, height: u32) -> AppResult<String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| error::AppError::Other(e.to_string()))?;
    let out = dir.join("region_shot.png");
    media::grab_screen_frame(&screen_id, x, y, width, height, &out).await?;
    Ok(out.to_string_lossy().into())
}

#[tauri::command]
async fn gen_waveform(path: String, out: String) -> AppResult<()> {
    media::generate_waveform(&PathBuf::from(&path), &PathBuf::from(&out)).await
}

#[tauri::command]
async fn export_project(app: AppHandle, project: ExportProject, settings: ExportSettings) -> AppResult<()> {
    export::export_project(&app, &project, &settings).await
}

#[tauri::command]
async fn pick_output_path(app: AppHandle, default_name: String) -> AppResult<Option<String>> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("Video", &["mp4", "webm", "mkv", "mov", "avi", "gif"])
        .save_file(move |path| {
            let _ = tx.send(path);
        });
    let path = rx.recv().ok().flatten();
    Ok(path.map(|p| p.into_path().ok().map(|x| x.to_string_lossy().into())).flatten())
}

#[tauri::command]
async fn open_in_file_manager(path: String) -> AppResult<()> {
    let p = PathBuf::from(&path);
    let target = if p.is_file() { p.parent().map(|x| x.to_path_buf()).unwrap_or(p) } else { p };
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer").arg(&target).spawn().ok();
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(&target).spawn().ok();
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open").arg(&target).spawn().ok();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let _ = ffmpeg::ensure_ffmpeg(&handle).await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ffmpeg_status,
            ensure_ffmpeg,
            list_devices,
            start_recording,
            stop_recording,
            pause_recording,
            resume_recording,
            save_recording_to,
            list_recent_sessions,
            load_session,
            probe_media,
            gen_thumbnail,
            gen_thumbnails,
            gen_waveform,
            grab_screen_frame,
            export_project,
            pick_output_path,
            open_in_file_manager,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
