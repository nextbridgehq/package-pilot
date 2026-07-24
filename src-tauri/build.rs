fn main() {
    // Skip tauri-build's own manifest embedding (which only reaches some
    // linked targets, not the --lib test harness - see below) and provide
    // it ourselves, applied uniformly to every target this package links.
    let attributes = tauri_build::Attributes::new()
        .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
    tauri_build::try_build(attributes).expect("failed to run tauri-build");

    // The Windows app manifest declares the Common-Controls v6 dependency
    // tao/wry's window creation needs. `cargo test`'s --lib binary links
    // the same tao/wry stack via AppState's tauri::AppHandle field but,
    // pre-fix, got no manifest at all: Windows then resolved comctl32.dll
    // et al. against the old unmanifested side-by-side versions and the
    // test binary crashed at load time with STATUS_ENTRYPOINT_NOT_FOUND
    // before main() ever ran. Embedding it here via an unscoped
    // cargo:rustc-link-arg applies it to every linked target from this
    // package (bin, the bin's own test harness, and the --lib test harness
    // alike), so there's exactly one manifest source instead of tauri-build
    // and this both trying to embed one into the same target.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let manifest_path =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("windows-app-manifest.xml");
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg=/MANIFESTINPUT:{}",
            manifest_path.display()
        );
    }
}
