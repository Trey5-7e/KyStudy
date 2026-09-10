//! M0-B transport experiment: loopback-only HTTP, no credentials or production wiring.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::{Duration, Instant};

use tauri::async_runtime::{JoinHandle, spawn};

#[path = "support/answer.rs"]
mod answer;
use answer::{AnswerKind, parse_envelope};

const WAIT: Duration = Duration::from_secs(5);
const RELEASE_LIMIT: Duration = Duration::from_secs(2);

#[derive(Clone, Copy)]
enum Stage {
    Headers,
    SilentBody,
    PartialEvent,
}

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
enum TransportError {
    #[error("AGENT_TRANSPORT_ERROR")]
    Network,
    #[error("AGENT_PROVIDER_PROTOCOL_ERROR")]
    Protocol,
    #[error("AGENT_BUDGET_EXHAUSTED")]
    Budget,
}

// Owner survives navigation in the eventual host; dropping it aborts instead of detaching.
struct RequestOwner(JoinHandle<Result<(), TransportError>>);

impl Drop for RequestOwner {
    fn drop(&mut self) {
        self.0.abort();
    }
}

struct Dropped(Sender<()>);

impl Drop for Dropped {
    fn drop(&mut self) {
        let _ = self.0.send(());
    }
}

fn start_request(url: String, stage: Sender<()>, dropped: Sender<()>) -> RequestOwner {
    RequestOwner(spawn(async move {
        let _dropped = Dropped(dropped);
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(WAIT)
            .build()
            .map_err(|_| TransportError::Network)?;
        let mut response = client
            .get(url)
            .send()
            .await
            .map_err(|_| TransportError::Network)?;
        if !response.status().is_success()
            || response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                != Some("text/event-stream")
        {
            return Err(TransportError::Protocol);
        }
        let _ = stage.send(());
        let mut received = 0_usize;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| TransportError::Network)?
        {
            if chunk.len() > 16_384 - received {
                return Err(TransportError::Budget);
            }
            received += chunk.len();
            let _ = stage.send(());
        }
        // No protocol adapter has validated a finish event: transport EOF is never success.
        Err(TransportError::Protocol)
    }))
}

fn read_request(stream: &mut TcpStream) {
    // Accepted sockets can inherit the listener's nonblocking mode on Windows.
    stream.set_nonblocking(false).unwrap();
    stream.set_read_timeout(Some(WAIT)).unwrap();
    stream.set_write_timeout(Some(WAIT)).unwrap();
    let mut request = Vec::new();
    let mut byte = [0_u8; 1];
    while !request.ends_with(b"\r\n\r\n") {
        assert!(request.len() < 8192, "oversized fixture request");
        stream.read_exact(&mut byte).unwrap();
        request.push(byte[0]);
    }
}

fn accept_bounded(listener: &TcpListener) -> TcpStream {
    listener.set_nonblocking(true).unwrap();
    let started = Instant::now();
    loop {
        match listener.accept() {
            Ok((stream, _)) => return stream,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                assert!(started.elapsed() < WAIT, "client never connected");
                thread::sleep(Duration::from_millis(5));
            }
            Err(error) => panic!("fixture accept failed: {error}"),
        }
    }
}

fn cancellation_case(stage: Stage) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/fixture", listener.local_addr().unwrap());
    let (ready_tx, ready_rx) = mpsc::channel();
    let (closed_tx, closed_rx) = mpsc::channel();
    let server = thread::spawn(move || {
        let mut stream = accept_bounded(&listener);
        read_request(&mut stream);
        if !matches!(stage, Stage::Headers) {
            stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n").unwrap();
            if matches!(stage, Stage::PartialEvent) {
                let event = b"data: {\"arguments\":\"unfinished";
                write!(stream, "{:x}\r\n", event.len()).unwrap();
                stream.write_all(event).unwrap();
                stream.write_all(b"\r\n").unwrap();
            }
            stream.flush().unwrap();
        }
        ready_tx.send(()).unwrap();
        let mut byte = [0_u8; 1];
        let closed = match stream.read(&mut byte) {
            Ok(0) => true,
            Err(error) => matches!(
                error.kind(),
                std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::ConnectionAborted
            ),
            Ok(_) => false,
        };
        closed_tx.send(closed).unwrap();
    });
    let (stage_tx, stage_rx) = mpsc::channel();
    let (dropped_tx, dropped_rx) = mpsc::channel();
    let owner = start_request(url, stage_tx, dropped_tx);
    ready_rx.recv_timeout(WAIT).unwrap();
    if !matches!(stage, Stage::Headers) {
        stage_rx.recv_timeout(WAIT).unwrap();
    }
    if matches!(stage, Stage::PartialEvent) {
        stage_rx.recv_timeout(WAIT).unwrap();
    }
    let started = Instant::now();
    drop(owner);
    assert_closed(&dropped_rx, &closed_rx, started);
    server.join().unwrap();
}

fn assert_closed(dropped: &Receiver<()>, closed: &Receiver<bool>, started: Instant) {
    dropped
        .recv_timeout(RELEASE_LIMIT)
        .expect("request future was not dropped");
    assert!(
        closed
            .recv_timeout(RELEASE_LIMIT.saturating_sub(started.elapsed()))
            .expect("server did not observe closure")
    );
    assert!(started.elapsed() < RELEASE_LIMIT);
    eprintln!("local transport released in {:?}", started.elapsed());
}

#[test]
fn cancel_while_waiting_for_headers_closes_socket() {
    cancellation_case(Stage::Headers);
}

#[test]
fn cancel_silent_sse_closes_socket() {
    cancellation_case(Stage::SilentBody);
}

#[test]
fn cancel_partial_sse_closes_socket() {
    cancellation_case(Stage::PartialEvent);
}

#[test]
fn eof_without_validated_finish_is_protocol_failure() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/fixture", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        let mut stream = accept_bounded(&listener);
        read_request(&mut stream);
        stream
            .write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: 0\r\n\r\n",
            )
            .unwrap();
    });
    let (stage_tx, _) = mpsc::channel();
    let (dropped_tx, dropped_rx) = mpsc::channel();
    let mut owner = start_request(url, stage_tx, dropped_tx);
    dropped_rx.recv_timeout(WAIT).unwrap();
    assert_eq!(
        tauri::async_runtime::block_on(&mut owner.0).unwrap(),
        Err(TransportError::Protocol)
    );
    server.join().unwrap();
}

#[test]
fn final_and_needs_input_envelopes_are_distinct() {
    for (raw, expected) in [
        (
            r#"{"schemaVersion":1,"kind":"final","message":"Answer","sourceIds":["s1"]}"#,
            AnswerKind::Final,
        ),
        (
            r#"{"schemaVersion":1,"kind":"needs_input","message":"Please clarify","sourceIds":[],"question":"Which chapter?"}"#,
            AnswerKind::NeedsInput,
        ),
    ] {
        assert_eq!(parse_envelope(raw, &["s1"], 0).unwrap().kind, expected);
    }
}

#[test]
fn invalid_envelopes_cannot_be_interpreted_as_actions() {
    for raw in [
        r#"{"schemaVersion":1,"kind":"final","message":"Answer","sourceIds":["forged"]}"#,
        r#"{"schemaVersion":1,"kind":"needs_input","message":"Clarify","sourceIds":[]}"#,
        r#"{"schemaVersion":1,"kind":"final","message":"Answer","sourceIds":[],"question":"Why?"}"#,
        r#"{"schemaVersion":1,"kind":"final","message":"Answer","sourceIds":[],"tool":"shell"}"#,
        r#"{"schemaVersion":2,"kind":"final","message":"Answer","sourceIds":[]}"#,
        r#"{"schemaVersion":1,"kind":"final","message":" ","sourceIds":[]}"#,
        "plain text is not an envelope",
    ] {
        assert!(matches!(
            parse_envelope(raw, &["s1"], 0),
            Err(answer::OutputError)
        ));
    }
}

#[test]
fn pending_tool_prevents_final_answer() {
    let raw = r#"{"schemaVersion":1,"kind":"final","message":"Answer","sourceIds":[]}"#;
    assert!(matches!(
        parse_envelope(raw, &[], 1),
        Err(answer::OutputError)
    ));
}
