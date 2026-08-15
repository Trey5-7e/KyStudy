#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! `KyStudy` desktop executable entry point.

fn main() {
    kystudy_lib::run();
}
