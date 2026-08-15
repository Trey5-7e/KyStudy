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

/// Fixed question categories used by review-scheme quotas.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum QuestionType {
    Choice,
    Blank,
    Solution,
    Other,
}

impl QuestionType {
    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "choice" => Some(Self::Choice),
            "blank" => Some(Self::Blank),
            "solution" => Some(Self::Solution),
            "other" => Some(Self::Other),
            _ => None,
        }
    }

    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Choice => "choice",
            Self::Blank => "blank",
            Self::Solution => "solution",
            Self::Other => "other",
        }
    }

    pub(crate) const fn all() -> [Self; 4] {
        [Self::Choice, Self::Blank, Self::Solution, Self::Other]
    }
}

/// Provenance of the current question-type classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ClassificationSource {
    Pending,
    Automatic,
    Manual,
}

impl ClassificationSource {
    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "pending" => Some(Self::Pending),
            "automatic" => Some(Self::Automatic),
            "manual" => Some(Self::Manual),
            _ => None,
        }
    }

    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Automatic => "automatic",
            Self::Manual => "manual",
        }
    }
}

/// Result from the deliberately small local classifier.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct QuestionTypeSuggestion {
    pub(crate) question_type: Option<QuestionType>,
    pub(crate) confidence: f64,
}

/// Classifies OCR or title text without a network request.
pub(crate) fn classify_question_text(text: &str) -> QuestionTypeSuggestion {
    let normalized = text.to_lowercase();
    let has_choice_options = ["a.", "a．", "a、", "a ", "（a）", "(a)"]
        .iter()
        .any(|marker| normalized.contains(marker))
        && ["b.", "b．", "b、", "b ", "（b）", "(b)"]
            .iter()
            .any(|marker| normalized.contains(marker));
    if normalized.contains("选择题") || has_choice_options {
        return QuestionTypeSuggestion {
            question_type: Some(QuestionType::Choice),
            confidence: 0.94,
        };
    }
    if normalized.contains("填空题")
        || normalized.contains("填入")
        || normalized.contains("____")
        || normalized.contains("＿＿＿＿")
    {
        return QuestionTypeSuggestion {
            question_type: Some(QuestionType::Blank),
            confidence: 0.9,
        };
    }
    if ["解答题", "证明", "计算", "求解", "请说明", "请分析"]
        .iter()
        .any(|marker| normalized.contains(marker))
    {
        return QuestionTypeSuggestion {
            question_type: Some(QuestionType::Solution),
            confidence: 0.82,
        };
    }
    QuestionTypeSuggestion {
        question_type: None,
        confidence: 0.35,
    }
}

/// Workbook-level subject inherited by questions without an override.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WorkbookProfile {
    pub(crate) document_id: String,
    pub(crate) default_subject_id: Option<String>,
    pub(crate) default_subject_name: Option<String>,
    pub(crate) pending_classification_count: u32,
    pub(crate) updated_at: Option<i64>,
}

/// One user-confirmed question sourced from a local workbook.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Question {
    pub(crate) id: String,
    pub(crate) document_id: String,
    pub(crate) document_title: String,
    pub(crate) subject_id: Option<String>,
    pub(crate) subject_name: Option<String>,
    pub(crate) subject_inherited: bool,
    #[expect(
        clippy::struct_field_names,
        reason = "question type is the stable persisted domain term"
    )]
    pub(crate) question_type: Option<QuestionType>,
    pub(crate) classification_source: ClassificationSource,
    pub(crate) classification_confidence: Option<f64>,
    pub(crate) title: String,
    pub(crate) chapter: Option<String>,
    pub(crate) number_label: Option<String>,
    pub(crate) difficulty: u8,
    pub(crate) analysis_markdown: Option<String>,
    pub(crate) deleted_at: Option<i64>,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
}

#[cfg(test)]
mod classification_tests {
    use super::{QuestionType, classify_question_text};

    #[test]
    fn classifier_recognizes_choice_options() {
        let suggestion = classify_question_text("下列说法正确的是 A. 甲 B. 乙");

        assert_eq!(suggestion.question_type, Some(QuestionType::Choice));
    }

    #[test]
    fn classifier_leaves_ambiguous_text_pending() {
        let suggestion = classify_question_text("第 12 题");

        assert_eq!(suggestion.question_type, None);
    }
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
