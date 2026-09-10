//! Shared M0 application answer envelope; never interprets text as a tool action.

#[derive(Debug, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum AnswerKind {
    Final,
    NeedsInput,
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct Envelope {
    schema_version: u32,
    pub(super) kind: AnswerKind,
    message: String,
    source_ids: Vec<String>,
    question: Option<String>,
}

#[derive(Debug)]
pub(super) struct OutputError;

pub(super) fn parse_envelope(
    raw: &str,
    allowed_sources: &[&str],
    pending_calls: usize,
) -> Result<Envelope, OutputError> {
    if raw.len() > 16_384 || pending_calls != 0 {
        return Err(OutputError);
    }
    let envelope: Envelope = serde_json::from_str(raw).map_err(|_| OutputError)?;
    if envelope.schema_version != 1
        || envelope.message.trim().is_empty()
        || envelope.message.len() > 8192
        || envelope.source_ids.len() > 100
        || envelope
            .source_ids
            .iter()
            .any(|id| !allowed_sources.contains(&id.as_str()))
    {
        return Err(OutputError);
    }
    match (&envelope.kind, &envelope.question) {
        (AnswerKind::Final, None) => Ok(envelope),
        (AnswerKind::NeedsInput, Some(question))
            if !question.trim().is_empty() && question.len() <= 1024 =>
        {
            Ok(envelope)
        }
        _ => Err(OutputError),
    }
}
