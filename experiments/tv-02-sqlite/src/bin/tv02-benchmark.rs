//! Release-mode scale measurement executable for TV-02.

use std::process::ExitCode;

use tv_02_sqlite::{ScaleReport, run_scale_probe};

fn main() -> ExitCode {
    match run_scale_probe() {
        Ok(report) => {
            print_report(&report);
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("TV-02 scale probe failed ({}): {error}", error.code());
            ExitCode::FAILURE
        }
    }
}

fn print_report(report: &ScaleReport) {
    println!("TV-02 release scale probe");
    println!("SQLite version: {}", report.capabilities.sqlite_version);
    println!("SQLite source id: {}", report.capabilities.sqlite_source_id);
    println!(
        "journal mode: {}; foreign keys: {}; FTS5 trigram: {}",
        report.capabilities.journal_mode,
        report.capabilities.foreign_keys_enabled,
        report.capabilities.fts5_trigram_available
    );
    println!(
        "compile options: {}",
        report.capabilities.compile_options.join(", ")
    );
    println!("tasks: {}", report.task_rows);
    println!("attempts: {}", report.attempt_rows);
    println!("review events: {}", report.review_event_rows);
    println!("seed: {} ms", report.seed_millis);
    println!(
        "today task query mean (500 runs): {} us",
        report.today_query_mean_micros
    );
    println!(
        "due review query mean (500 runs): {} us",
        report.due_review_query_mean_micros
    );
    println!("backup: {} ms", report.backup_millis);
    println!("restore: {} ms", report.restore_millis);
    println!("backup bytes: {}", report.backup_bytes);
    println!("today task query plan: {:?}", report.today_query_plan);
    println!("due review query plan: {:?}", report.due_review_query_plan);
}
