//! Load the shipped console host before portable-pty initializes its ConPTY API.
//! The Windows system host can consume mouse modes instead of forwarding them to
//! xterm. Falling back to it silently makes wheel events become arrow keys.
use std::sync::OnceLock;

pub fn ensure_runtime() -> Result<(), String> {
    static RUNTIME: OnceLock<Result<libloading::Library, String>> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let dir = exe.parent().ok_or("Cannot locate the ConPTY runtime")?;
        if !dir.join("OpenConsole.exe").is_file() {
            return Err("Missing bundled OpenConsole.exe; rebuild or reinstall tcli".into());
        }
        // Use an absolute path so a project directory cannot supply the DLL.
        // Keeping the library alive lets portable-pty reuse this loaded module.
        unsafe {
            let library = libloading::Library::new(dir.join("conpty.dll"))
                .map_err(|e| format!("Cannot load bundled ConPTY; rebuild or reinstall tcli: {e}"))?;
            for symbol in [b"CreatePseudoConsole\0".as_slice(), b"ResizePseudoConsole\0", b"ClosePseudoConsole\0"] {
                library.get::<unsafe extern "system" fn()>(symbol)
                    .map_err(|e| format!("Invalid bundled ConPTY: {e}"))?;
            }
            Ok(library)
        }
    }).as_ref().map(|_| ()).map_err(Clone::clone)
}
