use std::io::{Read, Write};

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

use crate::{err, App};

pub struct Pty {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

/// Start `pi` (kind = "pi") or a plain shell (kind = "shell") in a new pty keyed by `id`,
/// and stream its raw output bytes to the frontend.
#[tauri::command]
pub fn pty_spawn(
    state: State<App>,
    id: u32,
    kind: String,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    wsl: Option<crate::wsl::Location>,
    pi_path: Option<String>,
    session_id: Option<String>,
    on_data: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    #[cfg(windows)]
    crate::windows_pty::ensure_runtime()?;
    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(err)?;

    let mut cmd = match (kind.as_str(), cfg!(windows), &wsl) {
        (_, true, Some(location)) => location.command(&kind, session_id.as_deref()),
        ("shell", true, None) => {
            let mut c = CommandBuilder::new("powershell.exe");
            c.arg("-NoLogo");
            c
        }
        ("shell", false, _) => CommandBuilder::new(std::env::var("SHELL").unwrap_or_else(|_| "sh".into())),
        (_, true, None) => {
            let path = crate::pi::resolve(pi_path)?;
            let mut c = CommandBuilder::new("powershell.exe");
            // Pass the selected path as data, never interpolate it into shell source.
            c.env("TCLI_PI_EXEC", path);
            // Respect pi's configured TUI mode, including its fullscreen mouse selection.
            let script = if let Some(id) = &session_id {
                c.env("TCLI_PI_SESSION", id);
                if id.ends_with(".jsonl") {
                    "& $env:TCLI_PI_EXEC --session $env:TCLI_PI_SESSION"
                } else {
                    "& $env:TCLI_PI_EXEC --session-id $env:TCLI_PI_SESSION"
                }
            } else {
                "& $env:TCLI_PI_EXEC"
            };
            c.args(["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]);
            c
        }
        (_, false, _) => {
            let mut c = CommandBuilder::new(crate::pi::resolve(pi_path)?);
            if let Some(id) = &session_id {
                let flag = if id.ends_with(".jsonl") { "--session" } else { "--session-id" };
                c.args([flag, id.as_str()]);
            }
            c
        }
    };
    if let Some(dir) = cwd.filter(|d| !d.is_empty() && wsl.is_none()) {
        cmd.cwd(dir);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("TERM_PROGRAM", "tcli");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("PI_HYPERLINKS", "1");
    // xterm has no image addon; inherited outer-terminal identifiers can mislead pi.
    cmd.env("PI_IMAGE_PROTOCOL", "none");
    // Make pi park the real cursor at its input position so the IME candidate window follows it.
    cmd.env("PI_HARDWARE_CURSOR", "1");

    let child = pair.slave.spawn_command(cmd).map_err(err)?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(err)?;
    let writer = pair.master.take_writer().map_err(err)?;

    // Register before output is forwarded: the frontend may immediately answer a query.
    state.ptys.lock().map_err(err)?.insert(id, Pty { master: pair.master, writer, child });
    std::thread::spawn(move || {
        let mut buf = [0u8; 16 * 1024];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 || on_data.send(InvokeResponseBody::Raw(buf[..n].to_vec())).is_err() {
                break;
            }
        }
    });

    Ok(())
}

#[derive(serde::Deserialize)]
#[serde(untagged)]
pub enum PtyInput {
    Text(String),
    Bytes(Vec<u8>),
}

#[tauri::command]
pub fn pty_write(state: State<App>, id: u32, data: PtyInput) -> Result<(), String> {
    let bytes = match data {
        PtyInput::Text(text) => text.into_bytes(),
        PtyInput::Bytes(bytes) => bytes,
    };
    if let Some(p) = state.ptys.lock().map_err(err)?.get_mut(&id) {
        p.writer.write_all(&bytes).map_err(err)?;
        p.writer.flush().map_err(err)?;
    }
    Ok(())
}

#[tauri::command]
pub fn pty_resize(state: State<App>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    if let Some(p) = state.ptys.lock().map_err(err)?.get(&id) {
        p.master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(err)?;
    }
    Ok(())
}

/// Close a tab's pty: kill the child, then drop the master (which also ends the reader thread).
#[tauri::command]
pub fn pty_close(state: State<App>, id: u32) -> Result<(), String> {
    if let Some(mut p) = state.ptys.lock().map_err(err)?.remove(&id) {
        let _ = p.child.kill();
    }
    Ok(())
}
