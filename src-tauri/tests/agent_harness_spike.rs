//! M0-A isolated experiment. No production commands, migrations, credentials or files.

use std::cell::Cell;
use std::collections::VecDeque;

use rusqlite::{Connection, params};
use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
enum Error {
    #[error("AGENT_SCOPE_DENIED")]
    Scope,
    #[error("AGENT_TOOL_NOT_ALLOWED")]
    Tool,
    #[error("AGENT_INVALID_ARGUMENTS")]
    Arguments,
    #[error("AGENT_BUDGET_EXHAUSTED")]
    Budget,
    #[error("AGENT_PROTOCOL_ERROR")]
    Protocol,
    #[error("AGENT_ALREADY_TERMINAL")]
    Terminal,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Source {
    document: String,
    revision: String,
    page: u32,
}

struct Grant {
    sources: Vec<Source>,
    tools: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Arguments {
    document: String,
    page: u32,
    query: Option<String>,
}

struct Call {
    id: String,
    name: String,
    arguments: String,
}

enum Response {
    Call(Call),
    Answer(String),
}

#[derive(Debug, PartialEq, Eq)]
struct ToolResult {
    call_id: String,
    source: Source,
    text: String,
}

trait Provider {
    fn next(&mut self, question: &str, results: &[ToolResult]) -> Result<Response, Error>;
}

trait Clock {
    fn now_ms(&self) -> u64;
}

struct FakeClock(Cell<u64>);

impl Clock for FakeClock {
    fn now_ms(&self) -> u64 {
        self.0.get()
    }
}

struct FakeProvider {
    responses: VecDeque<Response>,
    received: Vec<Vec<String>>,
}

impl Provider for FakeProvider {
    fn next(&mut self, question: &str, results: &[ToolResult]) -> Result<Response, Error> {
        if question.is_empty() {
            return Err(Error::Protocol);
        }
        self.received
            .push(results.iter().map(|result| result.text.clone()).collect());
        self.responses.pop_front().ok_or(Error::Protocol)
    }
}

struct FixtureTools {
    db: Connection,
    executions: usize,
}

impl FixtureTools {
    fn execute(
        &mut self,
        source: &Source,
        call: &Call,
        args: &Arguments,
    ) -> Result<ToolResult, Error> {
        self.executions += 1;
        // The bound identity restricts the query itself, including revision, before reading text.
        let text: String = self
            .db
            .query_row(
                "SELECT body FROM pages WHERE document = ?1 AND revision = ?2 AND page = ?3",
                params![source.document, source.revision, source.page],
                |row| row.get(0),
            )
            .map_err(|_| Error::Scope)?;
        let text = if call.name == "search_learning_resources"
            && !text.contains(args.query.as_deref().ok_or(Error::Arguments)?)
        {
            String::new()
        } else {
            text
        };
        Ok(ToolResult {
            call_id: call.id.clone(),
            source: source.clone(),
            text,
        })
    }
}

#[derive(Debug, PartialEq, Eq)]
enum State {
    Running,
    Completed,
    Failed(Error),
}

#[derive(Debug, PartialEq, Eq)]
enum Event {
    ModelReserved(u32),
    ToolReserved(u32),
    ToolCompleted(String),
    Finished,
    Failed(Error),
}

struct Run {
    grant: Grant,
    state: State,
    model_attempts: u32,
    tool_attempts: u32,
    model_limit: u32,
    tool_limit: u32,
    started_ms: u64,
    results: Vec<ToolResult>,
    events: Vec<Event>,
}

impl Run {
    fn execute(
        &mut self,
        question: &str,
        provider: &mut impl Provider,
        tools: &mut FixtureTools,
        clock: &impl Clock,
    ) -> Result<String, Error> {
        if self.state != State::Running {
            return Err(Error::Terminal);
        }
        let result = self.drive(question, provider, tools, clock);
        match &result {
            Ok(_) => {
                self.state = State::Completed;
                self.events.push(Event::Finished);
            }
            Err(error) => {
                self.state = State::Failed(*error);
                self.events.push(Event::Failed(*error));
            }
        }
        result
    }

    fn drive(
        &mut self,
        question: &str,
        provider: &mut impl Provider,
        tools: &mut FixtureTools,
        clock: &impl Clock,
    ) -> Result<String, Error> {
        loop {
            if self.model_attempts >= self.model_limit
                || clock.now_ms().saturating_sub(self.started_ms) >= 180_000
            {
                return Err(Error::Budget);
            }
            self.model_attempts += 1;
            self.events.push(Event::ModelReserved(self.model_attempts));
            let response = provider.next(question, &self.results)?;
            if clock.now_ms().saturating_sub(self.started_ms) >= 180_000 {
                return Err(Error::Budget);
            }
            match response {
                Response::Answer(text) => return Ok(text),
                Response::Call(call) => {
                    if self.tool_attempts >= self.tool_limit {
                        return Err(Error::Budget);
                    }
                    self.tool_attempts += 1;
                    self.events.push(Event::ToolReserved(self.tool_attempts));
                    let (source, args) = self.validate(&call)?;
                    let result = tools.execute(source, &call, &args)?;
                    self.events.push(Event::ToolCompleted(call.id));
                    self.results.push(result);
                }
            }
        }
    }

    fn validate(&self, call: &Call) -> Result<(&Source, Arguments), Error> {
        if !matches!(
            call.name.as_str(),
            "search_learning_resources" | "read_resource_pages"
        ) || !self.grant.tools.contains(&call.name)
        {
            return Err(Error::Tool);
        }
        if call.id.is_empty()
            || call.id.len() > 128
            || self.results.iter().any(|result| result.call_id == call.id)
        {
            return Err(Error::Protocol);
        }
        if call.arguments.len() > 4096 {
            return Err(Error::Arguments);
        }
        let args: Arguments =
            serde_json::from_str(&call.arguments).map_err(|_| Error::Arguments)?;
        if args.page == 0
            || args.document.is_empty()
            || args.document.len() > 128
            || args
                .query
                .as_ref()
                .is_some_and(|query| query.is_empty() || query.len() > 256)
            || (call.name == "search_learning_resources" && args.query.is_none())
            || (call.name == "read_resource_pages" && args.query.is_some())
        {
            return Err(Error::Arguments);
        }
        let source = self
            .grant
            .sources
            .iter()
            .find(|source| source.document == args.document && source.page == args.page)
            .ok_or(Error::Scope)?;
        Ok((source, args))
    }
}

fn fixture() -> (Run, FixtureTools, FakeClock) {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch(
        "CREATE TABLE pages(document TEXT, revision TEXT, page INTEGER, body TEXT);
        INSERT INTO pages VALUES ('algebra', 'v1', 1, 'similar matrices share eigenvalues');
        INSERT INTO pages VALUES ('private', 'v1', 1, 'secret');
        INSERT INTO pages VALUES ('algebra', 'v1', 2, 'unselected page');",
    )
    .unwrap();
    let run = Run {
        grant: Grant {
            sources: vec![Source {
                document: "algebra".into(),
                revision: "v1".into(),
                page: 1,
            }],
            tools: vec![
                "search_learning_resources".into(),
                "read_resource_pages".into(),
            ],
        },
        state: State::Running,
        model_attempts: 0,
        tool_attempts: 0,
        model_limit: 6,
        tool_limit: 8,
        started_ms: 0,
        results: vec![],
        events: vec![],
    };
    (
        run,
        FixtureTools { db, executions: 0 },
        FakeClock(Cell::new(0)),
    )
}

fn call(id: &str, name: &str, arguments: &str) -> Response {
    Response::Call(Call {
        id: id.into(),
        name: name.into(),
        arguments: arguments.into(),
    })
}

fn provider(responses: Vec<Response>) -> FakeProvider {
    FakeProvider {
        responses: responses.into(),
        received: vec![],
    }
}

#[test]
fn search_read_answer_returns_evidence_without_business_writes() {
    let (mut run, mut tools, clock) = fixture();
    let before = tools.db.total_changes();
    let mut provider = provider(vec![
        call(
            "s",
            "search_learning_resources",
            r#"{"document":"algebra","page":1,"query":"eigenvalues"}"#,
        ),
        call(
            "r",
            "read_resource_pages",
            r#"{"document":"algebra","page":1}"#,
        ),
        Response::Answer("See algebra page 1".into()),
    ]);
    assert_eq!(
        run.execute("Explain similarity", &mut provider, &mut tools, &clock),
        Ok("See algebra page 1".into())
    );
    assert_eq!(
        provider.received[2],
        vec!["similar matrices share eigenvalues"; 2]
    );
    assert_eq!(tools.db.total_changes(), before);
    assert_eq!(
        run.events,
        vec![
            Event::ModelReserved(1),
            Event::ToolReserved(1),
            Event::ToolCompleted("s".into()),
            Event::ModelReserved(2),
            Event::ToolReserved(2),
            Event::ToolCompleted("r".into()),
            Event::ModelReserved(3),
            Event::Finished
        ]
    );
}

#[test]
fn unauthorized_and_malformed_calls_never_execute() {
    for (name, arguments, expected) in [
        ("shell", "{}", Error::Tool),
        (
            "read_resource_pages",
            r#"{"document":"private","page":1}"#,
            Error::Scope,
        ),
        (
            "read_resource_pages",
            r#"{"document":"algebra","page":2}"#,
            Error::Scope,
        ),
        (
            "read_resource_pages",
            r#"{"document":"algebra","page":0}"#,
            Error::Arguments,
        ),
        (
            "read_resource_pages",
            r#"{"document":"algebra","page":1,"workspaceId":"other"}"#,
            Error::Arguments,
        ),
        (
            "search_learning_resources",
            r#"{"document":"algebra","page":1}"#,
            Error::Arguments,
        ),
        ("read_resource_pages", "{", Error::Arguments),
    ] {
        let (mut run, mut tools, clock) = fixture();
        assert_eq!(
            run.execute(
                "q",
                &mut provider(vec![call("x", name, arguments)]),
                &mut tools,
                &clock
            ),
            Err(expected)
        );
        assert_eq!((tools.executions, run.tool_attempts), (0, 1));
    }
}

#[test]
fn empty_grant_does_not_mean_all_documents() {
    let (mut run, mut tools, clock) = fixture();
    run.grant.sources.clear();
    assert_eq!(
        run.execute(
            "q",
            &mut provider(vec![call(
                "r",
                "read_resource_pages",
                r#"{"document":"algebra","page":1}"#
            )]),
            &mut tools,
            &clock
        ),
        Err(Error::Scope)
    );
    assert_eq!(tools.executions, 0);
}

#[test]
fn changed_revision_never_returns_stale_or_new_text() {
    let (mut run, mut tools, clock) = fixture();
    tools
        .db
        .execute(
            "UPDATE pages SET revision = 'v2' WHERE document = 'algebra'",
            [],
        )
        .unwrap();
    assert_eq!(
        run.execute(
            "q",
            &mut provider(vec![call(
                "r",
                "read_resource_pages",
                r#"{"document":"algebra","page":1}"#
            )]),
            &mut tools,
            &clock
        ),
        Err(Error::Scope)
    );
    assert!(run.results.is_empty());
}

#[test]
fn model_budget_stops_loop_before_next_dispatch() {
    let (mut run, mut tools, clock) = fixture();
    let mut fake = provider(
        (0..8)
            .map(|id| {
                call(
                    &id.to_string(),
                    "read_resource_pages",
                    r#"{"document":"algebra","page":1}"#,
                )
            })
            .collect(),
    );
    assert_eq!(
        run.execute("q", &mut fake, &mut tools, &clock),
        Err(Error::Budget)
    );
    assert_eq!((fake.received.len(), tools.executions), (6, 6));
}

#[test]
fn tool_budget_stops_before_execution() {
    let (mut run, mut tools, clock) = fixture();
    run.tool_limit = 0;
    assert_eq!(
        run.execute(
            "q",
            &mut provider(vec![call(
                "r",
                "read_resource_pages",
                r#"{"document":"algebra","page":1}"#
            )]),
            &mut tools,
            &clock
        ),
        Err(Error::Budget)
    );
    assert_eq!(tools.executions, 0);
}

#[test]
fn fake_clock_exhaustion_stops_before_provider() {
    let (mut run, mut tools, clock) = fixture();
    clock.0.set(180_000);
    let mut fake = provider(vec![]);
    assert_eq!(
        run.execute("q", &mut fake, &mut tools, &clock),
        Err(Error::Budget)
    );
    assert!(fake.received.is_empty());
}

#[test]
fn exhausted_provider_is_not_success_and_terminal_cannot_revive() {
    let (mut run, mut tools, clock) = fixture();
    assert_eq!(
        run.execute("q", &mut provider(vec![]), &mut tools, &clock),
        Err(Error::Protocol)
    );
    let events = run.events.len();
    assert_eq!(
        run.execute(
            "q",
            &mut provider(vec![Response::Answer("late".into())]),
            &mut tools,
            &clock
        ),
        Err(Error::Terminal)
    );
    assert_eq!(run.events.len(), events);
}

#[test]
fn provider_returning_after_deadline_cannot_execute_or_complete() {
    struct SlowProvider<'a> {
        clock: &'a FakeClock,
        response: Option<Response>,
    }
    impl Provider for SlowProvider<'_> {
        fn next(&mut self, _: &str, _: &[ToolResult]) -> Result<Response, Error> {
            self.clock.0.set(180_000);
            self.response.take().ok_or(Error::Protocol)
        }
    }
    for response in [
        Response::Answer("late answer".into()),
        call(
            "r",
            "read_resource_pages",
            r#"{"document":"algebra","page":1}"#,
        ),
    ] {
        let (mut run, mut tools, clock) = fixture();
        let mut slow = SlowProvider {
            clock: &clock,
            response: Some(response),
        };
        assert_eq!(
            run.execute("q", &mut slow, &mut tools, &clock),
            Err(Error::Budget)
        );
        assert_eq!(tools.executions, 0);
        assert_eq!(run.state, State::Failed(Error::Budget));
    }
}

#[test]
fn registered_tool_still_requires_grant_permission() {
    let (mut run, mut tools, clock) = fixture();
    run.grant.tools.clear();
    assert_eq!(
        run.execute(
            "q",
            &mut provider(vec![call(
                "r",
                "read_resource_pages",
                r#"{"document":"algebra","page":1}"#
            )]),
            &mut tools,
            &clock
        ),
        Err(Error::Tool)
    );
    assert_eq!(tools.executions, 0);
}

#[test]
fn oversized_arguments_are_rejected_before_execution() {
    let (mut run, mut tools, clock) = fixture();
    assert_eq!(
        run.execute(
            "q",
            &mut provider(vec![call("r", "read_resource_pages", &" ".repeat(4097))]),
            &mut tools,
            &clock
        ),
        Err(Error::Arguments)
    );
    assert_eq!(tools.executions, 0);
}

#[test]
fn duplicate_call_id_cannot_execute_twice() {
    let (mut run, mut tools, clock) = fixture();
    let mut fake = provider(
        (0..2)
            .map(|_| {
                call(
                    "same",
                    "read_resource_pages",
                    r#"{"document":"algebra","page":1}"#,
                )
            })
            .collect(),
    );
    assert_eq!(
        run.execute("q", &mut fake, &mut tools, &clock),
        Err(Error::Protocol)
    );
    assert_eq!((tools.executions, run.tool_attempts), (1, 2));
}
