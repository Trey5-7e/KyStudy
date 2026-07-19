/// User-recorded outcome for one question attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AttemptResult {
    Correct,
    Incorrect,
    Uncertain,
}

impl AttemptResult {
    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "correct" => Some(Self::Correct),
            "incorrect" => Some(Self::Incorrect),
            "uncertain" => Some(Self::Uncertain),
            _ => None,
        }
    }

    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Correct => "correct",
            Self::Incorrect => "incorrect",
            Self::Uncertain => "uncertain",
        }
    }
}

/// One user-confirmed question sourced from a local workbook.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Question {
    pub(crate) id: String,
    pub(crate) document_id: String,
    pub(crate) document_title: String,
    pub(crate) title: String,
    pub(crate) chapter: Option<String>,
    pub(crate) number_label: Option<String>,
    pub(crate) difficulty: u8,
    pub(crate) analysis_markdown: Option<String>,
    pub(crate) deleted_at: Option<i64>,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
}

/// A stable PDF-page rectangle belonging to one question.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct QuestionRegion {
    pub(crate) id: String,
    pub(crate) question_id: String,
    pub(crate) document_id: String,
    pub(crate) page_number: u32,
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
    pub(crate) coordinate_version: u8,
    pub(crate) sort_order: u32,
    pub(crate) created_at: i64,
}

/// One immutable practice result for a question.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct QuestionAttempt {
    pub(crate) id: String,
    pub(crate) question_id: String,
    pub(crate) result: AttemptResult,
    pub(crate) attempted_at: i64,
    pub(crate) duration_seconds: Option<u32>,
    pub(crate) answer_note: Option<String>,
    pub(crate) created_at: i64,
}

/// Safe identifying details for a linked knowledge node.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct QuestionKnowledgeLink {
    pub(crate) node_id: String,
    pub(crate) node_title: String,
    pub(crate) map_id: String,
    pub(crate) map_title: String,
}

/// Complete question details used by the workbook UI.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct QuestionBundle {
    pub(crate) question: Question,
    pub(crate) regions: Vec<QuestionRegion>,
    pub(crate) attempts: Vec<QuestionAttempt>,
    pub(crate) knowledge_links: Vec<QuestionKnowledgeLink>,
}
