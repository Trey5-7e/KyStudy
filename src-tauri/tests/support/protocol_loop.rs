//! Real loopback HTTP carrying synthetic native tool calls, then a final envelope.

use super::{ChatStream, ProtocolError, chunk};
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;
use std::time::{Duration, Instant};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Args {
    page: u32,
}

fn serve_fixture(listener: &TcpListener) {
    for round in 0..3 {
        let start = Instant::now();
        let mut socket = loop {
            match listener.accept() {
                Ok((socket, _)) => break socket,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    assert!(start.elapsed() < Duration::from_secs(5));
                    thread::sleep(Duration::from_millis(5));
                }
                Err(error) => panic!("{error}"),
            }
        };
        socket.set_nonblocking(false).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        socket
            .set_write_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut header = Vec::new();
        let mut byte = [0];
        while !header.ends_with(b"\r\n\r\n") {
            assert!(header.len() < 8192);
            socket.read_exact(&mut byte).unwrap();
            header.push(byte[0]);
        }
        let header = String::from_utf8(header).unwrap();
        let length: usize = header
            .lines()
            .find_map(|line| {
                line.to_ascii_lowercase()
                    .strip_prefix("content-length: ")
                    .map(str::to_owned)
            })
            .unwrap()
            .parse()
            .unwrap();
        assert!(length < 16_384);
        let mut body = vec![0; length];
        socket.read_exact(&mut body).unwrap();
        let request: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(request["messages"][0]["role"], "user");
        assert_eq!(request["tools"].as_array().unwrap().len(), 2);
        if round > 0 {
            assert_eq!(
                request["messages"].as_array().unwrap().last().unwrap()["tool_call_id"],
                format!("c{round}")
            );
        }
        let delta = if round < 2 {
            json!({"tool_calls":[{"index":0,"id":format!("c{}",round+1),"type":"function","function":{"name":if round == 0 {"search_learning_resources"} else {"read_resource_pages"},"arguments":"{\"page\":1}"}}]})
        } else {
            assert_eq!(
                request["messages"].as_array().unwrap().last().unwrap()["content"],
                "similar matrices share eigenvalues"
            );
            json!({"content":json!({"schemaVersion":1,"kind":"final","message":"See page 1","sourceIds":["page1"]}).to_string()})
        };
        let wire = [
            chunk(
                &delta,
                &json!(if round < 2 { "tool_calls" } else { "stop" }),
            ),
            "data: [DONE]\n\n".into(),
        ]
        .concat();
        write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",wire.len()).unwrap();
        for bytes in wire.as_bytes().chunks(7) {
            socket.write_all(bytes).unwrap();
        }
    }
}

#[test]
fn http_search_read_answer_requires_matching_results() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let url = format!("http://{}/chat/completions", listener.local_addr().unwrap());
    let server = thread::spawn(move || serve_fixture(&listener));
    let result = tauri::async_runtime::block_on(async {
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        let mut messages = vec![json!({"role":"user","content":"Explain similarity"})];
        let mut executed = Vec::new();
        for _ in 0..3 {
            let mut response = client
                .post(&url)
                .json(&json!({"model":"fixture-only","stream":true,"messages":messages,"tools":fixture_tools()}))
                .send()
                .await
                .map_err(|_| ProtocolError)?;
            let mut stream = ChatStream::default();
            while let Some(bytes) = response.chunk().await.map_err(|_| ProtocolError)? {
                stream.feed(&bytes)?;
            }
            let completed = stream.finish()?;
            if completed.calls.is_empty() {
                let envelope = super::answer::parse_envelope(&completed.text, &["page1"], 0)
                    .map_err(|_| ProtocolError)?;
                assert_eq!(envelope.kind, super::answer::AnswerKind::Final);
                return Ok(executed);
            }
            if completed.calls.len() != 1 {
                return Err(ProtocolError);
            }
            let call = &completed.calls[0];
            let args: Args = serde_json::from_str(&call.arguments).map_err(|_| ProtocolError)?;
            if args.page != 1 {
                return Err(ProtocolError);
            }
            let result = match call.name.as_str() {
                "search_learning_resources" => "page1",
                "read_resource_pages" => "similar matrices share eigenvalues",
                _ => return Err(ProtocolError),
            };
            executed.push(call.name.clone());
            messages.extend(completed.continuation(&[(&call.id, result)])?);
        }
        Err(ProtocolError)
    });
    server.join().unwrap();
    assert_eq!(
        result.unwrap(),
        vec!["search_learning_resources", "read_resource_pages"]
    );
}

fn fixture_tools() -> Vec<Value> {
    ["search_learning_resources","read_resource_pages"].iter().map(|name|json!({
        "type":"function","function":{"name":name,"description":"Read the synthetic authorized page only","strict":true,
        "parameters":{"type":"object","properties":{"page":{"type":"integer","minimum":1}},"required":["page"],"additionalProperties":false}}
    })).collect()
}
