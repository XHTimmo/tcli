#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod pty;
mod magpie;

use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;
use sysinfo::{Pid, ProcessesToUpdate, System};
use tauri::State;

pub struct App {
    pub ptys: Mutex<HashMap<u32, pty::Pty>>,
    sys: Mutex<System>,
}

pub fn err<E: ToString>(e: E) -> String {
    e.to_string()
}

#[derive(Serialize)]
struct Entry {
    name: String,
    dir: bool,
}

#[tauri::command]
fn list_dir(path: String) -> Result<Vec<Entry>, String> {
    let mut v: Vec<Entry> = std::fs::read_dir(path)
        .map_err(err)?
        .flatten()
        .map(|e| Entry {
            dir: e.file_type().map(|t| t.is_dir()).unwrap_or(false),
            name: e.file_name().to_string_lossy().into_owned(),
        })
        .collect();
    v.sort_by(|a, b| b.dir.cmp(&a.dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(v)
}

#[derive(Serialize)]
struct Proc {
    pid: u32,
    name: String,
    /// Share of total CPU capacity, 0-100 (not per-core like Unix top).
    cpu: f32,
    mem: u64,
}

#[derive(Serialize)]
struct Snapshot {
    cores: Vec<f32>,
    mem_used: u64,
    mem_total: u64,
    swap_used: u64,
    swap_total: u64,
    uptime: u64,
    proc_count: usize,
    procs: Vec<Proc>,
}

/// CPU usage needs two refreshes spaced apart, so the same `System` is reused between calls.
fn snapshot(sys: &mut System, sort: &str, limit: usize) -> Snapshot {
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let n = sys.cpus().len().max(1) as f32;
    let mut procs: Vec<Proc> = sys
        .processes()
        .iter()
        .map(|(pid, p)| Proc {
            pid: pid.as_u32(),
            name: p.name().to_string_lossy().into_owned(),
            cpu: p.cpu_usage() / n,
            mem: p.memory(),
        })
        .collect();
    if sort == "mem" {
        procs.sort_by(|a, b| b.mem.cmp(&a.mem));
    } else {
        procs.sort_by(|a, b| b.cpu.total_cmp(&a.cpu).then(b.mem.cmp(&a.mem)));
    }
    let proc_count = procs.len();
    procs.truncate(limit);
    Snapshot {
        cores: sys.cpus().iter().map(|c| c.usage()).collect(),
        mem_used: sys.used_memory(),
        mem_total: sys.total_memory(),
        swap_used: sys.used_swap(),
        swap_total: sys.total_swap(),
        uptime: System::uptime().unwrap_or(0),
        proc_count,
        procs,
    }
}

#[tauri::command]
fn sys_snapshot(state: State<App>, sort: String, limit: usize) -> Result<Snapshot, String> {
    let mut sys = state.sys.lock().map_err(err)?;
    Ok(snapshot(&mut sys, &sort, limit))
}

#[tauri::command]
fn kill_process(state: State<App>, pid: u32) -> Result<bool, String> {
    let sys = state.sys.lock().map_err(err)?;
    Ok(sys.process(Pid::from_u32(pid)).map(|p| p.kill()).unwrap_or(false))
}

#[tauri::command]
fn home_dir() -> String {
    std::env::current_dir().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_has_real_data() {
        let mut sys = System::new().unwrap();
        snapshot(&mut sys, "cpu", 5);
        // Burn some CPU so the second sample has something to report.
        let t = std::time::Instant::now();
        let mut x = 0u64;
        while t.elapsed() < std::time::Duration::from_millis(600) {
            x = x.wrapping_add(1);
        }
        std::hint::black_box(x);
        let s = snapshot(&mut sys, "cpu", 5);
        eprintln!("cores={} mem={}/{} procs={} top={:?}", s.cores.len(), s.mem_used, s.mem_total, s.proc_count, s.procs.first().map(|p| (&p.name, p.cpu)));
        assert!(!s.cores.is_empty());
        assert!(s.mem_total > 0 && s.mem_used <= s.mem_total);
        assert!(s.procs.len() <= 5 && s.proc_count > 10);
        assert!(s.cores.iter().any(|c| *c > 0.0));
    }
}

fn main() {
    rustls::crypto::ring::default_provider().install_default().expect("rustls crypto provider");
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(App { ptys: Mutex::new(HashMap::new()), sys: Mutex::new(System::new().expect("sysinfo")) })
        .invoke_handler(tauri::generate_handler![
            pty::pty_spawn, pty::pty_write, pty::pty_resize, pty::pty_close, list_dir, sys_snapshot, kill_process, home_dir,
            magpie::magpie_routes
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tcli");
}
