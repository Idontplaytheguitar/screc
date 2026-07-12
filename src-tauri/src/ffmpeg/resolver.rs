use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::error::{AppError, AppResult};

const MIN_VERSION: u32 = 5;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FfmpegPaths {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
    pub source: BinarySource,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BinarySource {
    System,
    Bundled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum FfmpegStatus {
    Resolved { paths: FfmpegPaths, version: String },
    Downloading { progress: f64, message: String },
    Failed { error: String },
}

static PATHS: OnceLock<FfmpegPaths> = OnceLock::new();
static RESOLVE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub fn get() -> AppResult<&'static FfmpegPaths> {
    PATHS.get().ok_or_else(|| AppError::Ffmpeg("FFmpeg not initialized".into()))
}

pub async fn ensure_ffmpeg(app: &AppHandle) -> AppResult<FfmpegPaths> {
    if let Some(p) = PATHS.get() {
        return Ok(p.clone());
    }
    // Serialize concurrent resolution attempts (setup task + frontend both call this at launch).
    let _guard = RESOLVE_LOCK.lock().await;
    if let Some(p) = PATHS.get() {
        return Ok(p.clone());
    }

    // 1. System detection.
    if let Some(p) = detect_system().await {
        if let Ok(ver) = crate::ffmpeg::runner::probe_version(&p.ffmpeg).await {
            if major_version(&ver) >= MIN_VERSION {
                let resolved = FfmpegPaths {
                    ffmpeg: p.ffmpeg,
                    ffprobe: p.ffprobe,
                    source: BinarySource::System,
                };
                emit_status(app, &FfmpegStatus::Resolved { version: ver, paths: resolved.clone() });
                let _ = PATHS.set(resolved.clone());
                return Ok(resolved);
            }
        }
    }

    // 2. Cached download.
    let cache_dir = app_data_dir(app)?;
    let cache = cache_paths(&cache_dir);
    if cache.ffmpeg.exists() {
        if let Ok(ver) = crate::ffmpeg::runner::probe_version(&cache.ffmpeg).await {
            if major_version(&ver) >= MIN_VERSION {
                let resolved = FfmpegPaths {
                    ffmpeg: cache.ffmpeg.clone(),
                    ffprobe: cache.ffprobe.clone(),
                    source: BinarySource::Bundled,
                };
                emit_status(app, &FfmpegStatus::Resolved { version: ver, paths: resolved.clone() });
                let _ = PATHS.set(resolved.clone());
                return Ok(resolved);
            }
        }
    }

    // 3. Download.
    emit_status(app, &FfmpegStatus::Downloading { progress: 0.0, message: "Preparing download…".into() });
    let paths = download_and_install(app, &cache_dir).await?;
    match crate::ffmpeg::runner::probe_version(&paths.ffmpeg).await {
        Ok(ver) if major_version(&ver) >= MIN_VERSION => {
            emit_status(app, &FfmpegStatus::Resolved { version: ver, paths: paths.clone() });
            let _ = PATHS.set(paths.clone());
            Ok(paths)
        }
        Ok(ver) => {
            let msg = format!("downloaded FFmpeg reports version '{ver}' (need >= {MIN_VERSION}); the build may be incompatible");
            emit_status(app, &FfmpegStatus::Failed { error: msg.clone() });
            Err(AppError::Ffmpeg(msg))
        }
        Err(e) => {
            let msg = format!("downloaded FFmpeg failed to start: {e}");
            emit_status(app, &FfmpegStatus::Failed { error: msg.clone() });
            // Clean up so the next attempt re-downloads.
            let _ = std::fs::remove_file(&paths.ffmpeg);
            let _ = std::fs::remove_file(&paths.ffprobe);
            Err(AppError::Ffmpeg(msg))
        }
    }
}

fn app_data_dir(app: &AppHandle) -> AppResult<PathBuf> {
    app.path().app_data_dir()
        .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))
}

async fn detect_system() -> Option<FfmpegPaths> {
    let ffmpeg = find_binary("ffmpeg").await?;
    let ffprobe = find_binary("ffprobe").await
        .or_else(|| derive_probe_from_ffmpeg(&ffmpeg))
        .unwrap_or_else(|| PathBuf::from(ffmpeg.to_string_lossy().replace("ffmpeg", "ffprobe")));
    Some(FfmpegPaths { ffmpeg, ffprobe, source: BinarySource::System })
}

async fn find_binary(name: &str) -> Option<PathBuf> {
    let which = if cfg!(windows) { "where" } else { "which" };
    if let Ok(out) = tokio::process::Command::new(which).arg(name).output().await {
        if out.status.success() {
            if let Some(line) = String::from_utf8_lossy(&out.stdout).lines().next() {
                let p = PathBuf::from(line.trim());
                if p.exists() {
                    return Some(p);
                }
            }
        }
    }
    for candidate in common_install_locations(name) {
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

fn derive_probe_from_ffmpeg(ffmpeg: &Path) -> Option<PathBuf> {
    let replaced = ffmpeg.to_string_lossy().replace("ffmpeg", "ffprobe");
    let p = PathBuf::from(replaced);
    if p.exists() { Some(p) } else { None }
}

fn common_install_locations(name: &str) -> Vec<PathBuf> {
    let mut v = Vec::new();
    if cfg!(target_os = "windows") {
        let exe = format!("{name}.exe");
        for base in ["C:\\Program Files\\ffmpeg\\bin", "C:\\ffmpeg\\bin", "C:\\ProgramData\\chocolatey\\bin"] {
            v.push(PathBuf::from(base).join(&exe));
        }
    } else if cfg!(target_os = "macos") {
        for base in ["/opt/homebrew/bin", "/usr/local/bin", "/opt/homebrew/opt/ffmpeg/bin"] {
            v.push(PathBuf::from(base).join(name));
        }
    } else {
        for base in ["/usr/bin", "/usr/local/bin", "/snap/bin"] {
            v.push(PathBuf::from(base).join(name));
        }
    }
    v
}

fn cache_paths(app_data: &Path) -> FfmpegPaths {
    let dir = app_data.join("ffmpeg");
    let exe = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    let probe = if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" };
    FfmpegPaths {
        ffmpeg: dir.join(exe),
        ffprobe: dir.join(probe),
        source: BinarySource::Bundled,
    }
}

fn major_version(version: &str) -> u32 {
    let v = version.trim();
    let v = v.strip_prefix("ffmpeg version").unwrap_or(v).trim();
    // BtbN/master builds report "ffmpeg version N-12345-gabcdef..." — skip the
    // non-digit build tag and parse the first run of digits.
    let digits: String = v
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(|c| c.is_ascii_digit())
        .collect();
    digits.parse().unwrap_or(0)
}

async fn download_and_install(app: &AppHandle, app_data: &Path) -> AppResult<FfmpegPaths> {
    let cache = cache_paths(app_data);
    std::fs::create_dir_all(cache.ffmpeg.parent().unwrap())?;

    let asset = download_asset();
    let archive_path = cache.ffmpeg.parent().unwrap().join("ffmpeg_download");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60 * 10))
        .build()?;
    let resp = client.get(&asset.url).send().await?.error_for_status()?;
    let total = resp.content_length().unwrap_or(0);

    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;
    let mut file = tokio::fs::File::create(&archive_path).await?;
    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_emit = std::time::Instant::now();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        file.write_all(&chunk).await?;
        downloaded += chunk.len() as u64;
        if last_emit.elapsed() > Duration::from_millis(80) {
            let progress = if total > 0 { downloaded as f64 / total as f64 } else { 0.0 };
            emit_status(app, &FfmpegStatus::Downloading {
                progress,
                message: format!("Downloading… {:.1} MB", downloaded as f64 / 1_048_576.0),
            });
            last_emit = std::time::Instant::now();
        }
    }
    file.flush().await?;
    drop(file);

    emit_status(app, &FfmpegStatus::Downloading { progress: 1.0, message: "Extracting…".into() });
    extract(&archive_path, &cache).await?;
    let _ = std::fs::remove_file(&archive_path);

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for p in [&cache.ffmpeg, &cache.ffprobe] {
            if p.exists() {
                let mut perms = std::fs::metadata(p)?.permissions();
                perms.set_mode(0o755);
                std::fs::set_permissions(p, perms)?;
            }
        }
    }

    if !cache.ffmpeg.exists() {
        return Err(AppError::Ffmpeg("FFmpeg binary not found after extraction".into()));
    }
    Ok(cache)
}

#[derive(Debug)]
struct DownloadAsset {
    url: String,
}

fn download_asset<'a>() -> DownloadAsset {
    let url: &'a str = match () {
        _ if cfg!(target_os = "windows") && cfg!(target_arch = "x86_64") => {
            "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
        }
        _ if cfg!(target_os = "windows") && cfg!(target_arch = "aarch64") => {
            // No native ARM64 build; use x64 build (runs via Windows emulation).
            "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
        }
        _ if cfg!(target_os = "linux") && cfg!(target_arch = "x86_64") => {
            "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz"
        }
        _ if cfg!(target_os = "linux") && cfg!(target_arch = "aarch64") => {
            "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linuxarm64-gpl.tar.xz"
        }
        _ if cfg!(target_os = "macos") && cfg!(target_arch = "x86_64") => {
            "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-macos64-gpl.tar.xz"
        }
        _ if cfg!(target_os = "macos") && cfg!(target_arch = "aarch64") => {
            "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-macosarm64-gpl.tar.xz"
        }
        _ => "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz",
    };
    DownloadAsset { url: url.to_string() }
}

async fn extract(archive: &Path, target: &FfmpegPaths) -> AppResult<()> {
    let dir = target.ffmpeg.parent().unwrap().to_path_buf();

    let mut buf = [0u8; 4];
    if let Ok(mut f) = std::fs::File::open(archive) {
        use std::io::Read;
        let _ = f.read_exact(&mut buf);
    }
    let ext = archive.extension().and_then(|e| e.to_str()).unwrap_or("");

    let is_zip = ext == "zip" || buf[..2] == [0x50, 0x4b];
    let is_xz = (buf[0] == 0xfd && buf[1] == 0x37 && buf[2] == 0x7a && buf[3] == 0x58) || ext == "xz";
    let is_gz = (buf[0] == 0x1f && buf[1] == 0x8b) || ext == "gz";

    if is_zip {
        extract_zip(archive, &dir)?;
        flatten_to_bin(&dir, target);
        return Ok(());
    }
    if is_xz || is_gz || ext == "tar" {
        extract_tar_system(archive, &dir).await?;
        flatten_to_bin(&dir, target);
        return Ok(());
    }
    Err(AppError::Ffmpeg(format!("Unknown archive format: {}", archive.display())))
}

fn extract_zip(archive: &Path, out_dir: &Path) -> AppResult<()> {
    let file = std::fs::File::open(archive)?;
    let mut za = zip::ZipArchive::new(file)?;
    for i in 0..za.len() {
        let mut entry = za.by_index(i)?;
        let path = out_dir.join(entry.name());
        if entry.is_dir() {
            std::fs::create_dir_all(&path)?;
        } else {
            if let Some(p) = path.parent() { std::fs::create_dir_all(p)?; }
            let mut out = std::fs::File::create(&path)?;
            std::io::copy(&mut entry, &mut out)?;
        }
    }
    Ok(())
}

async fn extract_tar_system(archive: &Path, out_dir: &Path) -> AppResult<()> {
    std::fs::create_dir_all(out_dir)?;
    let status = tokio::process::Command::new("tar")
        .arg("-xf").arg(archive)
        .arg("-C").arg(out_dir)
        .arg("--strip-components=1")
        .arg("--wildcards")
        .arg("*/ffmpeg").arg("*/ffprobe")
        .arg("ffmpeg").arg("ffprobe")
        .status().await;
    let ok = matches!(status, Ok(s) if s.success());
    if !ok {
        let _ = tokio::process::Command::new("tar")
            .arg("-xf").arg(archive)
            .arg("-C").arg(out_dir)
            .status().await;
    }
    Ok(())
}

fn flatten_to_bin(dir: &Path, target: &FfmpegPaths) {
    let exe = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    let probe = if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" };
    for (name, dest) in [(exe, &target.ffmpeg), (probe, &target.ffprobe)] {
        if dest.exists() { continue; }
        if let Some(found) = find_file(dir, name) {
            let _ = std::fs::copy(&found, dest);
        }
    }
}

fn find_file(root: &Path, name: &str) -> Option<PathBuf> {
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = std::fs::read_dir(&dir).ok()?;
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else if p.file_name().map(|n| n == name).unwrap_or(false) {
                return Some(p);
            }
        }
    }
    None
}

fn emit_status(app: &AppHandle, status: &FfmpegStatus) {
    let _ = app.emit("ffmpeg://status", status);
}
