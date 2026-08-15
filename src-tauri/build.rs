//! Tauri build-time configuration entry point.

fn main() {
    println!("cargo:rerun-if-env-changed=KYSTUDY_OCR_DOWNLOAD_URL");
    println!("cargo:rerun-if-env-changed=KYSTUDY_OCR_DOWNLOAD_SHA256");
    if let Ok(url) = std::env::var("KYSTUDY_OCR_DOWNLOAD_URL") {
        println!("cargo:rustc-env=KYSTUDY_OCR_DOWNLOAD_URL={url}");
    }
    if let Ok(sha256) = std::env::var("KYSTUDY_OCR_DOWNLOAD_SHA256") {
        println!("cargo:rustc-env=KYSTUDY_OCR_DOWNLOAD_SHA256={sha256}");
    }
    tauri_build::build();
}
