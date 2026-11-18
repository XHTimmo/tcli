#![cfg(windows)]

#[path = "../src/windows_pty.rs"]
mod windows_pty;

use portable_pty::{native_pty_system, Child, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::sync::mpsc;
use std::time::{Duration, Instant};

struct KillOnDrop(Box<dyn Child + Send + Sync>);
impl Drop for KillOnDrop {
    fn drop(&mut self) { let _ = self.0.kill(); }
}

#[test]
fn fullscreen_mouse_modes_and_reports_survive_conpty() {
    // Cargo places test executables separately from the app; stage the same
    // runtime that build.rs verified and Tauri copies beside tcli.exe.
    let exe = std::env::current_exe().unwrap();
    for file in ["conpty.dll", "OpenConsole.exe"] {
        std::fs::copy(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("conpty/runtime").join(file),
            exe.parent().unwrap().join(file)).unwrap();
    }
    windows_pty::ensure_runtime().unwrap();
    let pair = native_pty_system().openpty(PtySize {
        rows: 24, cols: 100, pixel_width: 0, pixel_height: 0,
    }).unwrap();
    // Match tcli's Windows launcher, including the intermediate PowerShell.
    let mut command = CommandBuilder::new("powershell.exe");
    command.args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "& node.exe $env:TCLI_MOUSE_FIXTURE"]);
    command.env("TCLI_MOUSE_FIXTURE", concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/mouse-protocol.cjs"));
    command.env("TERM", "xterm-256color");
    command.env("TERM_PROGRAM", "tcli");
    let _child = KillOnDrop(pair.slave.spawn_command(command).unwrap());
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().unwrap();
    let mut writer = pair.master.take_writer().unwrap();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = [0; 4096];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 || tx.send(buf[..n].to_vec()).is_err() { break; }
        }
    });
    let deadline = Instant::now() + Duration::from_secs(15);
    let mut output = String::new();
    let (mut cursor_replied, mut attributes_replied, mut sent) = (false, false, false);
    loop {
        let bytes = rx.recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .unwrap_or_else(|e| panic!("PTY timed out/closed: {e}; output: {output:?}"));
        output.push_str(&String::from_utf8_lossy(&bytes));
        // Answer the same terminal queries as xterm, even across read boundaries.
        if !cursor_replied && output.contains("\x1b[6n") {
            writer.write_all(b"\x1b[1;1R").unwrap();
            cursor_replied = true;
        }
        if !attributes_replied && output.contains("\x1b[c") {
            writer.write_all(b"\x1b[?1;2c").unwrap();
            attributes_replied = true;
        }
        if !sent && output.contains("MOUSE_READY") {
            for mode in [1049, 1000, 1002, 1003, 1004, 1006] {
                assert!(output.contains(&format!("\x1b[?{mode}h")), "ConPTY swallowed mouse mode {mode}: {output:?}");
            }
            writer.write_all(b"\x1b[<64;10;5M\x1b[<65;10;5M\x1b[<0;12;6M\x1b[<32;14;6M\x1b[<0;14;6m").unwrap();
            sent = true;
        }
        assert!(!output.contains("BAD_INPUT:"), "ConPTY changed mouse input: {output:?}");
        if output.contains("NORMAL_SCREEN_OK") {
            assert!(sent && output.contains("MOUSE_INPUT_OK"));
            for mode in [1049, 1000, 1002, 1003, 1004, 1006] {
                assert!(output.contains(&format!("\x1b[?{mode}l")), "ConPTY swallowed mode reset {mode}: {output:?}");
            }
            break;
        }
    }
}
