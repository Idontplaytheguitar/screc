use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::ffmpeg::resolver;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AudioKind {
    Mic,
    SystemLoopback,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDevice {
    /// Stable id used as the ffmpeg input spec argument.
    pub id: String,
    pub name: String,
    pub kind: AudioKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Screen {
    /// Index/id used by the capture input.
    pub id: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub primary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Webcam {
    /// ffmpeg input spec.
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowInfo {
    pub id: String,
    pub title: String,
    pub app: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceList {
    pub screens: Vec<Screen>,
    pub webcams: Vec<Webcam>,
    pub audio: Vec<AudioDevice>,
    pub windows: Vec<WindowInfo>,
    pub supports_system_audio: bool,
}

pub async fn enumerate_devices() -> AppResult<DeviceList> {
    let _ = resolver::get(); // ensure ffmpeg resolved; listing may still use system tools

    #[cfg(target_os = "linux")]
    return linux_devices().await;
    #[cfg(target_os = "macos")]
    return macos_devices().await;
    #[cfg(target_os = "windows")]
    return windows_devices().await;
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    return Err(AppError::Platform("unsupported OS".into()));
}

// ---------------------------------------------------------------------------
// Linux
// ---------------------------------------------------------------------------

#[cfg(target_os = "linux")]
async fn linux_devices() -> AppResult<DeviceList> {
    use tokio::process::Command;
    let mut screens = Vec::new();

    // xrandr --listmonitors
    if let Ok(out) = Command::new("xrandr").arg("--listmonitors").output().await {
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            if let Some(rest) = line.strip_prefix(" ") {
                // " 0: +*DP-1 1920/473x1080/296+0+0  DP-1"
                let parts: Vec<&str> = rest.split_whitespace().collect();
                if parts.len() >= 2 {
                    let id_raw = parts.get(1).map(|s| s.to_string()).unwrap_or_default();
                    let id = id_raw.trim_start_matches('+').trim_start_matches('*').to_string();
                    let primary = id_raw.contains('*');
                    let geom = parts.get(2).map(|s| s.to_string()).unwrap_or_default();
                    let (w, h, x, y) = parse_xrandr_geom(&geom);
                    screens.push(Screen { id: id.clone(), name: id, width: w, height: h, x, y, primary });
                }
            }
        }
    }
    // Fallback: assume one screen at :0.0
    if screens.is_empty() {
        screens.push(Screen {
            id: "0".into(),
            name: "Default screen".into(),
            width: 1920,
            height: 1080,
            x: 0,
            y: 0,
            primary: true,
        });
    }

    // Audio: pulse/pipewire sources via pactl list short sources
    let mut audio = Vec::new();
    let supports_loopback = which("pactl").await || which("pw-cli").await;
    if which("pactl").await {
        if let Ok(out) = Command::new("pactl").args(["list", "short", "sources"]).output().await {
            for line in String::from_utf8_lossy(&out.stdout).lines() {
                // <id>\t<name>\t<module>\t<monitor>\t<state>
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() < 2 { continue; }
                let id = parts[1].to_string();
                let is_monitor = id.ends_with(".monitor");
                let friendly = id.split('.').last().unwrap_or(&id).to_string();
                audio.push(AudioDevice {
                    id,
                    name: friendly,
                    kind: if is_monitor { AudioKind::SystemLoopback } else { AudioKind::Mic },
                });
            }
        }
    }

    // Webcams: v4l2-ctl --list-devices
    let mut webcams = Vec::new();
    if which("v4l2-ctl").await {
        if let Ok(out) = Command::new("v4l2-ctl").arg("--list-devices").output().await {
            let s = String::from_utf8_lossy(&out.stdout);
            let mut name: Option<String> = None;
            for line in s.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() { continue; }
                if trimmed.starts_with("/dev/video") {
                    if let Some(n) = name.take() {
                        webcams.push(Webcam { id: trimmed.to_string(), name: n });
                    } else {
                        webcams.push(Webcam { id: trimmed.to_string(), name: trimmed.to_string() });
                    }
                } else {
                    name = Some(trimmed.to_string());
                }
            }
        }
    }

    // Windows: wmctrl -lG (id, desktop, x, y, w, h, host, title...)
    let mut windows = Vec::new();
    if which("wmctrl").await {
        if let Ok(out) = Command::new("wmctrl").arg("-lG").output().await {
            for line in String::from_utf8_lossy(&out.stdout).lines() {
                // 0x0380000b  0 0    0    1920 1080 host Window Title
                let parts: Vec<&str> = line.splitn(8, char::is_whitespace).filter(|s| !s.is_empty()).collect();
                if parts.len() < 7 { continue; }
                let id = parts[0].to_string();
                let x: i32 = parts[2].parse().unwrap_or(0);
                let y: i32 = parts[3].parse().unwrap_or(0);
                let w: u32 = parts[4].parse().unwrap_or(0);
                let h: u32 = parts[5].parse().unwrap_or(0);
                let title = parts.get(7).map(|s| s.trim().to_string()).unwrap_or_default();
                if title.is_empty() || w == 0 || h == 0 { continue; }
                let app = title.split(" - ").last().unwrap_or(&title).to_string();
                windows.push(WindowInfo { id, title, app, x, y, width: w, height: h });
            }
        }
    } else if which("xdotool").await {
        if let Ok(out) = Command::new("sh").arg("-c").arg("xdotool search --onlyvisible --name '' getwindowgeometry %@").output().await {
            let _ = out; // best-effort; geometry parsing is fiddly, skip if empty
        }
    }

    Ok(DeviceList { screens, webcams, audio, windows, supports_system_audio: supports_loopback })
}

#[cfg(target_os = "linux")]
fn parse_xrandr_geom(geom: &str) -> (u32, u32, i32, i32) {
    // "1920/473x1080/296+0+0"
    let mut w = 0u32; let mut h = 0u32; let mut x = 0i32; let mut y = 0i32;
    if let Some((wh, rest)) = geom.split_once('x') {
        w = wh.split('/').next().and_then(|s| s.parse().ok()).unwrap_or(0);
        if let Some((hh, rest)) = rest.split_once('+') {
            h = hh.split('/').next().and_then(|s| s.parse().ok()).unwrap_or(0);
            let parts: Vec<&str> = rest.split('+').collect();
            x = parts.first().and_then(|s| s.parse().ok()).unwrap_or(0);
            y = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
        }
    }
    (w, h, x, y)
}

// ---------------------------------------------------------------------------
// macOS
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
async fn macos_devices() -> AppResult<DeviceList> {
    use tokio::process::Command;

    // avfoundation -list_devices true
    let mut screens = Vec::new();
    let mut webcams = Vec::new();
    let mut audio = Vec::new();

    if let Ok(out) = Command::new("ffmpeg")
        .args(["-list_devices", "true", "-f", "avfoundation", "-i", "dummy"])
        .output().await
    {
        let s = String::from_utf8_lossy(&out.stderr);
        let mut section: Option<&str> = None;
        for line in s.lines() {
            let line = line.trim();
            if line.contains("AVFoundation video devices") { section = Some("video"); continue; }
            if line.contains("AVFoundation audio devices") { section = Some("audio"); continue; }
            if let Some(sec) = section {
                if let Some(idx) = line.strip_prefix("[") {
                    if let Some((n, rest)) = idx.split_once(']') {
                        let name = rest.trim().trim_start_matches(' ').to_string();
                        let id = n.to_string();
                        if sec == "video" {
                            // Heuristic: screens contain "Capture screen"; webcams contain "camera"
                            if name.to_lowercase().contains("capture screen") {
                                screens.push(Screen {
                                    id: id.clone(),
                                    name,
                                    width: 0, height: 0, x: 0, y: 0,
                                    primary: screens.is_empty(),
                                });
                            } else {
                                webcams.push(Webcam { id, name });
                            }
                        } else {
                            audio.push(AudioDevice { id, name, kind: AudioKind::Mic });
                        }
                    }
                }
            }
        }
    }
    // macOS 13+ supports system audio capture via avfoundation screen with audio.
    let supports_system_audio = true;

    Ok(DeviceList { screens, webcams, audio, windows: Vec::new(), supports_system_audio })
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
async fn windows_devices() -> AppResult<DeviceList> {
    // Screens via Windows API.
    let screens = windows_screens();
    let mut webcams = Vec::new();
    let mut audio = Vec::new();

    // dshow -list_devices true (stderr parse)
    use tokio::process::Command;
    if let Ok(out) = Command::new("ffmpeg")
        .args(["-list_devices", "true", "-f", "dshow", "-i", "dummy"])
        .output().await
    {
        let s = String::from_utf8_lossy(&out.stderr);
        let mut section: Option<&str> = None;
        let mut pending: Option<String> = None;
        for line in s.lines() {
            let line = line.trim();
            if line.contains("DirectShow video devices") { section = Some("video"); continue; }
            if line.contains("DirectShow audio devices") { section = Some("audio"); continue; }
            if let Some(sec) = section {
                // "  "USB Camera" (audio:...)
                // The device name is between double quotes.
                if let Some(start) = line.find('"') {
                    if let Some(end) = line.rfind('"') {
                        if end > start {
                            let name = line[start+1..end].to_string();
                            if sec == "video" {
                                webcams.push(Webcam { id: name.clone(), name });
                            } else {
                                audio.push(AudioDevice { id: name.clone(), name, kind: AudioKind::Mic });
                            }
                        }
                    }
                }
                let _ = pending;
            }
        }
    }
    // WASAPI loopback for system audio is always available on Win10+.
    let supports_system_audio = true;

    let win_list = windows_windows();

    Ok(DeviceList { screens, webcams, audio, windows: win_list, supports_system_audio })
}

#[cfg(target_os = "windows")]
fn windows_windows() -> Vec<WindowInfo> {
    use std::sync::Mutex;
    use windows::Win32::Foundation::{BOOL, LPARAM, RECT};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowRect, GetWindowTextW, GetWindowTextLengthW, GetClassNameW,
        IsWindowVisible, GWL_STYLE, GetWindowLongW, WS_VISIBLE, WINDOW_STYLE,
    };

    static COLLECTED: Mutex<Vec<WindowInfo>> = Mutex::new(Vec::new());
    { COLLECTED.lock().unwrap().clear(); }

    unsafe extern "system" fn callback(hwnd: windows::Win32::Foundation::HWND, _l: LPARAM) -> BOOL {
        if !IsWindowVisible(hwnd).as_bool() { return BOOL(1); }
        let style = WINDOW_STYLE(GetWindowLongW(hwnd, GWL_STYLE) as u32);
        if !style.contains(WS_VISIBLE) { return BOOL(1); }
        let mut len = GetWindowTextLengthW(hwnd);
        if len <= 0 { return BOOL(1); }
        len += 1;
        let mut buf = vec![0u16; len as usize];
        let n = GetWindowTextW(hwnd, &mut buf);
        if n <= 0 { return BOOL(1); }
        let title = String::from_utf16_lossy(&buf[..n as usize]).trim_end_matches('\0').to_string();
        if title.is_empty() { return BOOL(1); }
        let mut classbuf = [0u16; 256];
        let cn = GetClassNameW(hwnd, &mut classbuf);
        let app = if cn > 0 { String::from_utf16_lossy(&classbuf[..cn as usize]).trim_end_matches('\0').to_string() } else { String::new() };
        let mut rect = RECT::default();
        if GetWindowRect(hwnd, &mut rect).is_err() { return BOOL(1); }
        let x = rect.left; let y = rect.top;
        let w = (rect.right - rect.left) as u32;
        let h = (rect.bottom - rect.top) as u32;
        if w < 50 || h < 50 { return BOOL(1); }
        let id = format!("0x{:x}", hwnd.0 as usize);
        COLLECTED.lock().unwrap().push(WindowInfo { id, title, app, x, y, width: w, height: h });
        BOOL(1)
    }

    unsafe {
        let _ = EnumWindows(Some(callback), LPARAM(0));
        COLLECTED.lock().unwrap().clone()
    }
}

#[cfg(target_os = "windows")]
fn windows_screens() -> Vec<Screen> {
    use std::sync::Mutex;
    use windows::Win32::Graphics::Gdi::{EnumDisplayMonitors, GetMonitorInfoW, MonitorFromWindow, HDC, HMONITOR, MONITORINFOEXW, MONITOR_DEFAULTTOPRIMARY};
    use windows::Win32::Foundation::{BOOL, LPARAM, RECT};

    static COLLECTED: Mutex<Vec<Screen>> = Mutex::new(Vec::new());
    {
        let mut g = COLLECTED.lock().unwrap();
        g.clear();
    }

    unsafe extern "system" fn callback(hmon: HMONITOR, _hdc: HDC, lprect: *mut RECT, _l: LPARAM) -> BOOL {
        let mut info: MONITORINFOEXW = MONITORINFOEXW::default();
        info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
        let mut g = COLLECTED.lock().unwrap();
        let idx = g.len();
        let (w, h, x, y) = if !lprect.is_null() {
            let r = &*lprect;
            ((r.right - r.left) as u32, (r.bottom - r.top) as u32, r.left, r.top)
        } else { (0, 0, 0, 0) };
        let _ = GetMonitorInfoW(hmon, &mut info as *mut _ as _);
        let name = String::from_utf16_lossy(&info.szDevice)
            .trim_end_matches('\0')
            .to_string();
        g.push(Screen {
            id: format!("screen-{idx}"),
            name,
            width: w, height: h, x, y,
            primary: false,
        });
        BOOL(1)
    }

    unsafe {
        let _ = EnumDisplayMonitors(None, None, Some(callback), LPARAM(0));
        let mut g = COLLECTED.lock().unwrap();
        if g.is_empty() {
            let _hmon = MonitorFromWindow(None, MONITOR_DEFAULTTOPRIMARY);
            g.push(Screen { id: "0".into(), name: "Primary Display".into(), width: 1920, height: 1080, x: 0, y: 0, primary: true });
        } else {
            g[0].primary = true;
        }
        g.clone()
    }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async fn which(name: &str) -> bool {
    let cmd = if cfg!(windows) { "where" } else { "which" };
    tokio::process::Command::new(cmd)
        .arg(name)
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false)
}
