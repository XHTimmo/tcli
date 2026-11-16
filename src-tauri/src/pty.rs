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
    pi_path: Option<String>,
    on_data: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(err)?;

    let mut cmd = match (kind.as_str(), cfg!(windows)) {
        ("shell", true) => {
            let mut c = CommandBuilder::new("powershell.exe");
            c.arg("-NoLogo");
            c
        }
        ("shell", false) => CommandBuilder::new(std::env::var("SHELL").unwrap_or_else(|_| "sh".into())),
        (_, true) => {
            let path = crate::pi::resolve(pi_path)?;
            let mut c = CommandBuilder::new("powershell.exe");
            // Pass the selected path as data, never interpolate it into shell source.
            c.env("TCLI_PI_EXEC", path);
            // Regular mode lets xterm manage scrollback under ConPTY.
            c.args(["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "& $env:TCLI_PI_EXEC --tui-mode regular"]);
            c
        }
        (_, false) => {
            let mut c = CommandBuilder::new(crate::pi::resolve(pi_path)?);
            c.args(["--tui-mode", "regular"]);
            c
        }
    };
    if let Some(dir) = cwd.filter(|d| !d.is_empty()) {
        cmd.cwd(dir);
    }
    cmd.env("TERM", "xterm-256color");
    // Make pi park the real cursor at its input position so the IME candidate window follows it.
    cmd.env("PI_HARDWARE_CURSOR", "1");

    let child = pair.slave.spawn_command(cmd).map_err(err)?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(err)?;
    let writer = pair.master.take_writer().map_err(err)?;

    std::thread::spawn(move || {
        let mut buf = [0u8; 16 * 1024];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 || on_data.send(InvokeResponseBody::Raw(buf[..n].to_vec())).is_err() {
                break;
            }
        }
    });

    state.ptys.lock().map_err(err)?.insert(id, Pty { master: pair.master, writer, child });
    Ok(())
}

#[tauri::command]
pub fn pty_write(state: State<App>, id: u32, data: String) -> Result<(), String> {
    if let Some(p) = state.ptys.lock().map_err(err)?.get_mut(&id) {
        p.writer.write_all(data.as_bytes()).map_err(err)?;
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
