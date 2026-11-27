use portable_pty::CommandBuilder;

#[derive(serde::Deserialize)]
pub struct Location {
    distribution: String,
    path: String,
}

impl Location {
    pub fn command(&self, kind: &str, session: Option<&str>) -> CommandBuilder {
        let mut cmd = CommandBuilder::new("wsl.exe");
        cmd.args(["--distribution", &self.distribution, "--cd", &self.path]);
        if kind == "pi" {
            // Interactive Bash loads the same PATH as a user terminal (including nvm).
            cmd.args(["--exec", "bash", "-ic", "exec pi \"$@\"", "tcli"]);
            if let Some(id) = session {
                let flag = if id.ends_with(".jsonl") { "--session" } else { "--session-id" };
                cmd.args([flag, id]);
            }
        }
        let mut env = std::env::var("WSLENV").unwrap_or_default();
        for key in ["TERM", "TERM_PROGRAM", "COLORTERM", "PI_HYPERLINKS", "PI_IMAGE_PROTOCOL", "PI_HARDWARE_CURSOR"] {
            if !env.split(':').any(|item| item.split('/').next() == Some(key)) {
                if !env.is_empty() { env.push(':'); }
                env.push_str(key);
                env.push_str("/u");
            }
        }
        cmd.env("WSLENV", env);
        cmd
    }
}

#[tauri::command]
pub async fn wsl_home(distribution: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = std::process::Command::new("wsl.exe");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        if let Some(name) = distribution { cmd.args(["--distribution", &name]); }
        let output = cmd.args(["--cd", "~", "--exec", "wslpath", "-w", "."])
            .env("WSL_UTF8", "1").output().map_err(crate::err)?;
        if !output.status.success() {
            let message = [output.stderr, output.stdout].concat();
            return Err(String::from_utf8_lossy(&message).trim().to_string());
        }
        Ok(String::from_utf8(output.stdout).map_err(crate::err)?.trim_end_matches(['\r', '\n']).to_string())
    }).await.map_err(crate::err)?
}
