fn main() {
    // Recompile the Windows executable resources when application icons change.
    println!("cargo:rerun-if-changed=icons");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        println!("cargo:rerun-if-changed=tauri.windows.conf.json");
        println!("cargo:rerun-if-changed=../scripts/prepare-conpty.mjs");
        println!("cargo:rerun-if-changed=conpty");
        let status = std::process::Command::new("node")
            .args(["../scripts/prepare-conpty.mjs", &std::env::var("CARGO_CFG_TARGET_ARCH").unwrap()])
            .status()
            .expect("Node.js is required to prepare the bundled ConPTY runtime");
        assert!(status.success(), "Failed to prepare ConPTY; run node scripts/prepare-conpty.mjs from the repository root");
    }
    tauri_build::build()
}
