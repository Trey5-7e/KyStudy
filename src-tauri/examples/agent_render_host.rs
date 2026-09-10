//! Loopback-only M0-C render Host. Never used by the desktop application.

use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{Cursor, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Job {
    id: String,
    run_id: String,
    grant_id: String,
    document_id: String,
    revision: String,
    epoch: u32,
    page: u32,
    width: u32,
    height: u32,
    deadline: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    region: Option<[f64; 4]>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Reply {
    job: Job,
    mime: String,
    base64: String,
}

#[derive(Default)]
struct Host {
    issued: u32,
    epoch: u32,
    pending: HashMap<String, Job>,
    cache_bytes: usize,
}

impl Host {
    fn issue(&mut self, kind: &str, now: u64) -> Result<Job, &'static str> {
        if self.issued >= 8 {
            return Err("AGENT_BUDGET_EXHAUSTED");
        }
        let (page, region) = match kind {
            "page1" => (1, false),
            "page2" => (2, false),
            "region" => (1, true),
            _ => return Err("AGENT_SCOPE_DENIED"),
        };
        self.issued += 1;
        let job = Job {
            id: format!("rust-render-{}", self.issued),
            run_id: "run-fixture".into(),
            grant_id: "grant-fixture".into(),
            document_id: "two-pages".into(),
            revision: "v1".into(),
            epoch: self.epoch,
            page,
            width: if region { 480 } else { 600 },
            height: if region { 180 } else { 800 },
            deadline: now + 30_000,
            region: region.then_some([0.1, 0.175, 0.8, 0.225]),
        };
        self.pending.insert(job.id.clone(), job.clone());
        Ok(job)
    }

    fn accept(&mut self, reply: &Reply, now: u64) -> Result<String, &'static str> {
        let stored = self
            .pending
            .get(&reply.job.id)
            .ok_or("AGENT_RENDER_STALE")?;
        if stored != &reply.job || stored.epoch != self.epoch || now >= stored.deadline {
            return Err("AGENT_RENDER_STALE");
        }
        if reply.mime != "image/png" || reply.base64.len() > 5_592_408 {
            return Err("AGENT_RENDER_INVALID_IMAGE");
        }
        let bytes = STANDARD
            .decode(&reply.base64)
            .map_err(|_| "AGENT_RENDER_INVALID_IMAGE")?;
        if bytes.len() > 4 * 1024 * 1024 || self.cache_bytes + bytes.len() > 32 * 1024 * 1024 {
            return Err("AGENT_RENDER_TOO_LARGE");
        }
        validate_png(&bytes, stored.width, stored.height)?;
        self.pending.remove(&reply.job.id);
        self.cache_bytes += bytes.len();
        Ok(format!("{:x}", Sha256::digest(&bytes)))
    }

    fn restart(&mut self) {
        self.epoch += 1;
        self.pending.clear();
    }
}

fn validate_png(bytes: &[u8], width: u32, height: u32) -> Result<(), &'static str> {
    if width == 0 || height == 0 || width > 3000 || height > 3000 {
        return Err("AGENT_RENDER_TOO_LARGE");
    }
    let decoder = png::Decoder::new_with_limits(
        Cursor::new(bytes),
        png::Limits {
            bytes: 40 * 1024 * 1024,
        },
    );
    let mut reader = decoder
        .read_info()
        .map_err(|_| "AGENT_RENDER_INVALID_IMAGE")?;
    if reader.info().width != width
        || reader.info().height != height
        || reader.info().animation_control.is_some()
        || reader.output_buffer_size() > 36 * 1024 * 1024
    {
        return Err("AGENT_RENDER_INVALID_IMAGE");
    }
    let mut pixels = vec![0; reader.output_buffer_size()];
    reader
        .next_frame(&mut pixels)
        .map_err(|_| "AGENT_RENDER_INVALID_IMAGE")?;
    Ok(())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| {
            u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
        })
}

struct Request {
    method: String,
    path: String,
    body: Vec<u8>,
}

fn read_request(socket: &mut TcpStream) -> std::io::Result<Request> {
    let invalid =
        || std::io::Error::new(std::io::ErrorKind::InvalidData, "invalid fixture request");
    socket.set_read_timeout(Some(Duration::from_secs(5)))?;
    socket.set_write_timeout(Some(Duration::from_secs(5)))?;
    let mut header = Vec::new();
    let mut byte = [0];
    while !header.ends_with(b"\r\n\r\n") {
        if header.len() >= 8192 {
            return Err(invalid());
        }
        socket.read_exact(&mut byte)?;
        header.push(byte[0]);
    }
    let text = std::str::from_utf8(&header).map_err(|_| invalid())?;
    let mut lines = text.lines();
    let mut first = lines.next().ok_or_else(invalid)?.split_whitespace();
    let method = first.next().ok_or_else(invalid)?.to_owned();
    let path = first.next().ok_or_else(invalid)?.to_owned();
    let mut length = 0;
    let mut has_length = false;
    for line in lines {
        if line.is_empty() {
            continue;
        }
        let (name, value) = line.split_once(':').ok_or_else(invalid)?;
        if name.eq_ignore_ascii_case("origin") && value.trim() != "http://127.0.0.1:1420" {
            return Err(invalid());
        }
        if name.eq_ignore_ascii_case("transfer-encoding") {
            return Err(invalid());
        }
        if name.eq_ignore_ascii_case("content-length") {
            if has_length {
                return Err(invalid());
            }
            length = value.trim().parse::<usize>().map_err(|_| invalid())?;
            has_length = true;
        }
    }
    if length > 6 * 1024 * 1024 {
        return Err(invalid());
    }
    let mut body = vec![0; length];
    socket.read_exact(&mut body)?;
    Ok(Request { method, path, body })
}

fn route(host: &mut Host, request: &Request) -> Result<Value, &'static str> {
    match (request.method.as_str(), request.path.as_str()) {
        ("OPTIONS", _) => Ok(json!({})),
        ("GET", path) if path.starts_with("/job/") => {
            serde_json::to_value(host.issue(&path[5..], now_ms())?)
                .map_err(|_| "AGENT_RENDER_ERROR")
        }
        ("POST", "/reply") => {
            let reply: Reply =
                serde_json::from_slice(&request.body).map_err(|_| "AGENT_RENDER_INVALID_REPLY")?;
            Ok(json!({"sha256":host.accept(&reply,now_ms())?}))
        }
        ("POST", "/restart") => {
            host.restart();
            Ok(json!({"epoch":host.epoch}))
        }
        _ => Err("AGENT_SCOPE_DENIED"),
    }
}

fn main() -> std::io::Result<()> {
    let listener = TcpListener::bind("127.0.0.1:1431")?;
    let mut host = Host {
        epoch: 1,
        ..Host::default()
    };
    println!("M0 synthetic render Host: http://127.0.0.1:1431 (8 jobs, no user files)");
    for socket in listener.incoming() {
        let mut socket = socket?;
        let result = read_request(&mut socket)
            .map_err(|_| "AGENT_INVALID_REQUEST")
            .and_then(|request| route(&mut host, &request));
        let (status, body) = match result {
            Ok(value) => ("200 OK", value),
            Err(code) => ("400 Bad Request", json!({"code":code})),
        };
        let body = body.to_string();
        let _ = write!(
            socket,
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: http://127.0.0.1:1420\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png_bytes(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = Vec::new();
        {
            let encoder = png::Encoder::new(&mut bytes, width, height);
            let mut writer = encoder.write_header().unwrap();
            writer
                .write_image_data(&vec![128; usize::try_from(width * height).unwrap()])
                .unwrap();
        }
        bytes
    }

    #[test]
    fn decoded_png_hash_is_accepted_once() {
        let mut host = Host::default();
        let job = host.issue("region", 0).unwrap();
        let bytes = png_bytes(job.width, job.height);
        let reply = Reply {
            job,
            mime: "image/png".into(),
            base64: STANDARD.encode(&bytes),
        };
        assert_eq!(
            host.accept(&reply, 1).unwrap(),
            format!("{:x}", Sha256::digest(&bytes))
        );
        assert!(host.accept(&reply, 1).is_err());
    }

    #[test]
    fn corrupt_or_forged_png_is_not_accepted_from_header_alone() {
        let bytes = png_bytes(480, 180);
        assert!(validate_png(&bytes[..24], 480, 180).is_err());
        assert!(validate_png(&bytes, 600, 800).is_err());
    }

    #[test]
    fn stale_revision_region_and_epoch_never_accept() {
        let mut host = Host::default();
        let job = host.issue("region", 0).unwrap();
        let mut reply = Reply {
            job: job.clone(),
            mime: "image/png".into(),
            base64: STANDARD.encode(png_bytes(480, 180)),
        };
        reply.job.page = 2;
        assert!(host.accept(&reply, 1).is_err());
        reply.job = job.clone();
        reply.job.revision = "v2".into();
        assert!(host.accept(&reply, 1).is_err());
        reply.job = job;
        assert!(host.accept(&reply, 30_000).is_err());
        host.restart();
        assert!(host.accept(&reply, 1).is_err());
    }

    #[test]
    fn issue_budget_survives_renderer_restart() {
        let mut host = Host::default();
        for _ in 0..8 {
            host.issue("page1", 0).unwrap();
        }
        host.restart();
        assert!(host.issue("page1", 0).is_err());
        assert!(validate_png(&[], 3001, 1).is_err());
    }
}
