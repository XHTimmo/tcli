use std::path::{Path, PathBuf};

fn executable(path: &Path) -> bool {
    if !path.is_file() { return false; }
    #[cfg(windows)]
    { matches!(path.extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase().as_str(), "exe" | "cmd" | "bat" | "ps1") }
    #[cfg(unix)]
    { use std::os::unix::fs::PermissionsExt; path.metadata().map(|m| m.permissions().mode() & 0o111 != 0).unwrap_or(false) }
}

pub fn resolve(custom: Option<String>) -> Result<String, String> {
    if let Some(custom) = custom.filter(|p| !p.trim().is_empty()) {
        let path = PathBuf::from(custom.trim());
        if !path.is_absolute() || !executable(&path) {
            return Err("请选择有效的 pi 启动文件（完整路径），而不是目录或带参数的命令。".into());
        }
        return Ok(path.to_string_lossy().into_owned());
    }
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    // Also search the managed install location: the running app's PATH predates installation.
    if let Some(agent) = std::env::var_os("PI_CODING_AGENT_DIR") { dirs.push(PathBuf::from(agent).join("bin")); }
    if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
        dirs.push(PathBuf::from(home).join(".pi/agent/bin"));
    }
    if let Some(appdata) = std::env::var_os("APPDATA") { dirs.push(PathBuf::from(appdata).join("npm")); }
    for dir in dirs.into_iter().filter(|p| p.is_absolute()) {
        let names: &[&str] = if cfg!(windows) { &["pi.exe", "pi.cmd", "pi.bat", "pi.ps1"] } else { &["pi"] };
        for name in names {
            let path = dir.join(name);
            if executable(&path) { return Ok(path.to_string_lossy().into_owned()); }
        }
    }
    Err("未检测到 pi。请选择已有的 pi 启动文件，或点击一键安装。".into())
}

#[tauri::command]
pub fn detect_pi(path: Option<String>) -> Result<String, String> { resolve(path) }

#[tauri::command]
pub async fn install_pi() -> Result<String, String> {
    #[cfg(not(windows))]
    { Err("一键安装目前仅支持 Windows，请安装 pi 后选择启动文件。".into()) }
    #[cfg(windows)]
    {
        use std::sync::atomic::{AtomicBool, Ordering};
        static INSTALLING: AtomicBool = AtomicBool::new(false);
        if INSTALLING.swap(true, Ordering::SeqCst) { return Err("pi 正在安装，请等待安装窗口完成。".into()); }
        let result = tauri::async_runtime::spawn_blocking(|| {
            use std::io::Write;
            use std::os::windows::process::CommandExt;
            let mut script = tempfile::Builder::new().suffix(".ps1").tempfile().map_err(crate::err)?;
            script.write_all(include_bytes!("../scripts/install-pi.ps1")).map_err(crate::err)?;
            script.flush().map_err(crate::err)?;
            let status = std::process::Command::new("powershell.exe")
                .args(["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
                .arg(script.path())
                .creation_flags(0x00000010) // CREATE_NEW_CONSOLE: official installer prompts remain interactive.
                .status().map_err(crate::err)?;
            if !status.success() { return Err("安装未完成。请检查安装窗口中的错误后重试，或手动选择 pi 路径。".into()); }
            resolve(None)
        }).await.map_err(crate::err).and_then(|r| r);
        INSTALLING.store(false, Ordering::SeqCst);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_missing_relative_and_directory_paths() {
        assert!(resolve(Some("pi.cmd".into())).is_err());
        let dir = tempfile::tempdir().unwrap();
        assert!(resolve(Some(dir.path().to_string_lossy().into_owned())).is_err());
        assert!(resolve(Some(dir.path().join("missing.cmd").to_string_lossy().into_owned())).is_err());
    }
    #[test]
    #[cfg(windows)]
    fn accepts_launcher_paths_with_spaces_and_shell_characters() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("pi & tools.cmd");
        std::fs::write(&path, "@echo off").unwrap();
        assert_eq!(resolve(Some(path.to_string_lossy().into_owned())).unwrap(), path.to_string_lossy());
        let text = dir.path().join("pi.txt");
        std::fs::write(&text, "text").unwrap();
        assert!(resolve(Some(text.to_string_lossy().into_owned())).is_err());
    }
}
