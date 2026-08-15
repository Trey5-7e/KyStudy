//! Tauri build-time configuration entry point.

fn main() {
    println!("cargo:rerun-if-env-changed=KYSTUDY_OCR_DOWNLOAD_URL");
    println!("cargo:rerun-if-env-changed=KYSTUDY_OCR_DOWNLOAD_SHA256");
    tauri_build::build();
}
