//! M0-D deterministic selection and disposable `SQLite` handoff receipts.

use rusqlite::{Connection, params};
use serde::Deserialize;
use std::collections::HashSet;

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
enum Error {
    #[error("AGENT_INVALID_ARGUMENTS")]
    Arguments,
    #[error("AGENT_HANDOFF_CONFLICT")]
    Conflict,
    #[error("AGENT_STORE_ERROR")]
    Store,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Question {
    id: String,
    subject: String,
    kind: String,
    status: String,
    incorrect_count: u32,
    partial_count: u32,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Attempt {
    question_id: String,
    date: String,
}
#[derive(Deserialize)]
struct Quotas {
    choice: usize,
    blank: usize,
    solution: usize,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    algorithm_version: String,
    seed: u32,
    snapshot_revision: String,
    today: String,
    allowed_ids: Vec<String>,
    attempts: Vec<Attempt>,
    quotas: Quotas,
    questions: Vec<Question>,
    expected_ids: Vec<String>,
}

fn weight(question: &Question) -> Result<f64, Error> {
    let base = match question.status.as_str() {
        "unattempted" => 1.2,
        "correct" => 0.55,
        "uncertain" => 2.0,
        "incorrect" => 3.0,
        _ => return Err(Error::Arguments),
    };
    Ok(base + f64::from(question.incorrect_count) * 0.35 + f64::from(question.partial_count) * 0.2)
}

fn next_random(seed: &mut u32) -> f64 {
    *seed ^= *seed << 13;
    *seed ^= *seed >> 17;
    *seed ^= *seed << 5;
    f64::from(*seed) / 4_294_967_296.0
}

fn pick(fixture: &Fixture) -> Result<Vec<String>, Error> {
    if fixture.algorithm_version != "weighted-xorshift32-v1"
        || fixture.snapshot_revision.is_empty()
        || fixture.seed == 0
        || fixture.questions.len() > 10_000
        || fixture.allowed_ids.len() > 10_000
    {
        return Err(Error::Arguments);
    }
    let mut seed = fixture.seed;
    let allowed: HashSet<_> = fixture.allowed_ids.iter().collect();
    let today: HashSet<_> = fixture
        .attempts
        .iter()
        .filter(|attempt| attempt.date == fixture.today)
        .map(|attempt| &attempt.question_id)
        .collect();
    let mut unique_ids = HashSet::new();
    let mut candidates: Vec<_> = fixture
        .questions
        .iter()
        .filter(|q| {
            allowed.contains(&q.id)
                && q.subject == "linear"
                && !today.contains(&q.id)
                && unique_ids.insert(&q.id)
        })
        .collect();
    candidates.sort_by(|a, b| a.id.cmp(&b.id));
    let mut picked = Vec::new();
    for (kind, count) in [
        ("choice", fixture.quotas.choice),
        ("blank", fixture.quotas.blank),
        ("solution", fixture.quotas.solution),
    ] {
        if count > 50 {
            return Err(Error::Arguments);
        }
        let mut available: Vec<_> = candidates
            .iter()
            .filter(|q| q.kind == kind)
            .copied()
            .collect();
        for _ in 0..count.min(available.len()) {
            let weights: Vec<_> = available
                .iter()
                .map(|q| weight(q))
                .collect::<Result<_, _>>()?;
            let mut cursor = next_random(&mut seed) * weights.iter().sum::<f64>();
            let index = weights
                .iter()
                .position(|weight| {
                    cursor -= weight;
                    cursor <= 0.0
                })
                .unwrap_or(available.len() - 1);
            picked.push(available.remove(index).id.clone());
        }
    }
    Ok(picked)
}

fn fixture() -> Fixture {
    serde_json::from_str(include_str!(
        "../../src/preview/agent-spike/fixtures/practice.json"
    ))
    .unwrap()
}

#[test]
fn fixed_seed_matches_unchanged_typescript_selector_golden() {
    let fixture = fixture();
    assert_eq!(pick(&fixture).unwrap(), fixture.expected_ids);
}

#[test]
fn duplicate_or_reordered_candidates_do_not_change_seed_result() {
    let mut fixture = fixture();
    fixture.questions.push(fixture.questions[0].clone());
    fixture.questions.reverse();
    assert_eq!(pick(&fixture).unwrap(), fixture.expected_ids);
}

#[test]
fn shortfall_never_relaxes_scope_or_today_exclusion() {
    let mut fixture = fixture();
    fixture.quotas.choice = 50;
    fixture.quotas.blank = 50;
    fixture.quotas.solution = 50;
    let picked = pick(&fixture).unwrap();
    assert_eq!(picked.len(), 16);
    assert!(
        !picked
            .iter()
            .any(|id| ["q02", "q12", "q19", "q20"].contains(&id.as_str()))
    );
    fixture.allowed_ids.clear();
    assert!(pick(&fixture).unwrap().is_empty());
}

#[test]
fn invalid_algorithm_seed_or_quota_fails_before_selection() {
    for mode in 0..3 {
        let mut fixture = fixture();
        match mode {
            0 => fixture.seed = 0,
            1 => fixture.quotas.choice = 51,
            _ => fixture.algorithm_version = "unknown".into(),
        }
        assert_eq!(pick(&fixture), Err(Error::Arguments));
    }
}

fn open_receipts(path: &std::path::Path) -> Connection {
    let db = Connection::open(path).unwrap();
    db.execute_batch("CREATE TABLE IF NOT EXISTS handoffs(id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','acknowledged','canceled')));").unwrap();
    db
}

fn prepare(
    db: &Connection,
    id: &str,
    fingerprint: &str,
    payload: &str,
    approved: bool,
) -> Result<(), Error> {
    if !approved {
        return Err(Error::Conflict);
    }
    db.execute(
        "INSERT INTO handoffs VALUES (?1,?2,?3,'pending') ON CONFLICT(id) DO NOTHING",
        params![id, fingerprint, payload],
    )
    .map_err(|_| Error::Store)?;
    let matches: bool = db
        .query_row(
            "SELECT fingerprint=?2 AND payload=?3 AND state!='canceled' FROM handoffs WHERE id=?1",
            params![id, fingerprint, payload],
            |row| row.get(0),
        )
        .map_err(|_| Error::Store)?;
    if matches {
        Ok(())
    } else {
        Err(Error::Conflict)
    }
}

fn acknowledge(db: &Connection, id: &str, fingerprint: &str) -> Result<bool, Error> {
    let count=db.execute("UPDATE handoffs SET state='acknowledged' WHERE id=?1 AND fingerprint=?2 AND state='pending'",params![id,fingerprint]).map_err(|_|Error::Store)?;
    Ok(count == 1)
}

#[test]
fn durable_receipt_survives_reopen_and_ack_cas_wins_once() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("m0.sqlite");
    let fixture = fixture();
    let payload = serde_json::to_string(&pick(&fixture).unwrap()).unwrap();
    let db = open_receipts(&path);
    prepare(&db, "h1", "same-immutable-artifact", &payload, true).unwrap();
    drop(db);
    let db = open_receipts(&path);
    prepare(&db, "h1", "same-immutable-artifact", &payload, true).unwrap();
    assert!(acknowledge(&db, "h1", "same-immutable-artifact").unwrap());
    assert!(!acknowledge(&db, "h1", "same-immutable-artifact").unwrap());
    assert_eq!(
        prepare(&db, "h1", "different", "[]", true),
        Err(Error::Conflict)
    );
}

#[test]
fn denied_or_canceled_handoff_never_acknowledges() {
    let temp = tempfile::tempdir().unwrap();
    let db = open_receipts(&temp.path().join("m0.sqlite"));
    assert_eq!(
        prepare(&db, "h1", "artifact", "[]", false),
        Err(Error::Conflict)
    );
    assert!(!acknowledge(&db, "h1", "artifact").unwrap());
    prepare(&db, "h1", "artifact", "[]", true).unwrap();
    db.execute("UPDATE handoffs SET state='canceled' WHERE id='h1'", [])
        .unwrap();
    assert!(!acknowledge(&db, "h1", "artifact").unwrap());
    assert_eq!(
        prepare(&db, "h1", "artifact", "[]", true),
        Err(Error::Conflict)
    );
}
