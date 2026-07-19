use quick_xml::XmlVersion;
use quick_xml::events::{BytesStart, Event};
use quick_xml::reader::Reader;

use super::mindmap::KnowledgeError;
use super::resource::MindMapSource;
use crate::domain::MindMapDraftNode;

const MAX_IMPORT_NODES: u32 = 2_000;
const MAX_IMPORT_DEPTH: usize = 32;

pub(super) struct ParsedMindMap {
    pub(super) source_format: String,
    pub(super) title: String,
    pub(super) tree: MindMapDraftNode,
    pub(super) warnings: Vec<String>,
    pub(super) node_count: u32,
}

pub(super) fn parse_mindmap_source(
    source: &MindMapSource,
) -> Result<ParsedMindMap, KnowledgeError> {
    let format = match source.mime_type.as_str() {
        "text/x-opml" => ImportFormat::Opml,
        "application/x-freemind" => ImportFormat::FreeMind,
        _ => return Err(KnowledgeError::UnsupportedFormat),
    };
    parse_xml_tree(source, format)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ImportFormat {
    Opml,
    FreeMind,
}

impl ImportFormat {
    const fn token(self) -> &'static str {
        match self {
            Self::Opml => "opml",
            Self::FreeMind => "freemind",
        }
    }

    const fn element(self) -> &'static [u8] {
        match self {
            Self::Opml => b"outline",
            Self::FreeMind => b"node",
        }
    }
}

struct ParseState {
    stack: Vec<MindMapDraftNode>,
    roots: Vec<MindMapDraftNode>,
    node_count: u32,
    unnamed_count: u32,
    ignored_attribute_count: u32,
}

impl ParseState {
    fn new() -> Self {
        Self {
            stack: Vec::new(),
            roots: Vec::new(),
            node_count: 0,
            unnamed_count: 0,
            ignored_attribute_count: 0,
        }
    }

    fn start(
        &mut self,
        element: &BytesStart<'_>,
        reader: &Reader<&[u8]>,
        format: ImportFormat,
    ) -> Result<(), KnowledgeError> {
        if self.stack.len() >= MAX_IMPORT_DEPTH {
            return Err(KnowledgeError::ImportLimitExceeded);
        }
        let node = parse_node(element, reader, format, self)?;
        self.stack.push(node);
        Ok(())
    }

    fn empty(
        &mut self,
        element: &BytesStart<'_>,
        reader: &Reader<&[u8]>,
        format: ImportFormat,
    ) -> Result<(), KnowledgeError> {
        if self.stack.len() >= MAX_IMPORT_DEPTH {
            return Err(KnowledgeError::ImportLimitExceeded);
        }
        let node = parse_node(element, reader, format, self)?;
        self.append(node);
        Ok(())
    }

    fn end(&mut self) -> Result<(), KnowledgeError> {
        let node = self
            .stack
            .pop()
            .ok_or(KnowledgeError::InvalidImportSource)?;
        self.append(node);
        Ok(())
    }

    fn append(&mut self, node: MindMapDraftNode) {
        if let Some(parent) = self.stack.last_mut() {
            parent.children.push(node);
        } else {
            self.roots.push(node);
        }
    }

    fn increment_nodes(&mut self) -> Result<(), KnowledgeError> {
        self.node_count = self
            .node_count
            .checked_add(1)
            .ok_or(KnowledgeError::ImportLimitExceeded)?;
        if self.node_count > MAX_IMPORT_NODES {
            return Err(KnowledgeError::ImportLimitExceeded);
        }
        Ok(())
    }
}

fn parse_xml_tree(
    source: &MindMapSource,
    format: ImportFormat,
) -> Result<ParsedMindMap, KnowledgeError> {
    let mut reader = Reader::from_reader(source.bytes.as_slice());
    reader.config_mut().trim_text(true);
    let mut state = ParseState::new();

    loop {
        match reader
            .read_event()
            .map_err(|_| KnowledgeError::InvalidImportSource)?
        {
            Event::Start(element) if element.local_name().as_ref() == format.element() => {
                state.start(&element, &reader, format)?;
            }
            Event::Empty(element) if element.local_name().as_ref() == format.element() => {
                state.empty(&element, &reader, format)?;
            }
            Event::End(element) if element.local_name().as_ref() == format.element() => {
                state.end()?;
            }
            Event::DocType(_) => return Err(KnowledgeError::InvalidImportSource),
            Event::Eof => break,
            _ => {}
        }
    }
    if !state.stack.is_empty() || state.roots.is_empty() {
        return Err(KnowledgeError::InvalidImportSource);
    }

    let title = sanitize_title(&source.title, 120, "导入的思维导图");
    let root_count = state.roots.len();
    let tree = if root_count == 1 {
        state
            .roots
            .pop()
            .ok_or(KnowledgeError::InvalidImportSource)?
    } else {
        state.node_count = state
            .node_count
            .checked_add(1)
            .ok_or(KnowledgeError::ImportLimitExceeded)?;
        if state.node_count > MAX_IMPORT_NODES {
            return Err(KnowledgeError::ImportLimitExceeded);
        }
        MindMapDraftNode {
            title: title.clone(),
            note_markdown: None,
            children: state.roots,
        }
    };
    let mut warnings = Vec::new();
    if root_count > 1 {
        warnings.push(format!(
            "源文件包含 {root_count} 个顶层节点，已增加一个统一根节点。"
        ));
    }
    if state.unnamed_count > 0 {
        warnings.push(format!(
            "有 {} 个节点没有标题，已标记为“未命名节点”。",
            state.unnamed_count
        ));
    }
    if state.ignored_attribute_count > 0 {
        warnings.push(format!(
            "已忽略 {} 个样式、图标或格式私有属性；层级与标题不受影响。",
            state.ignored_attribute_count
        ));
    }
    Ok(ParsedMindMap {
        source_format: format.token().to_owned(),
        title,
        tree,
        warnings,
        node_count: state.node_count,
    })
}

fn parse_node(
    element: &BytesStart<'_>,
    reader: &Reader<&[u8]>,
    format: ImportFormat,
    state: &mut ParseState,
) -> Result<MindMapDraftNode, KnowledgeError> {
    state.increment_nodes()?;
    let mut title = None;
    let mut note = None;
    for attribute in element.attributes() {
        let attribute = attribute.map_err(|_| KnowledgeError::InvalidImportSource)?;
        let key = attribute.key.local_name();
        let key = key.as_ref();
        let recognized_title = match format {
            ImportFormat::Opml => {
                key.eq_ignore_ascii_case(b"text") || key.eq_ignore_ascii_case(b"title")
            }
            ImportFormat::FreeMind => key.eq_ignore_ascii_case(b"TEXT"),
        };
        let recognized_note =
            key.eq_ignore_ascii_case(b"_note") || key.eq_ignore_ascii_case(b"NOTE");
        if recognized_title || recognized_note {
            let value = attribute
                .decoded_and_normalized_value(XmlVersion::Implicit1_0, reader.decoder())
                .map_err(|_| KnowledgeError::InvalidImportSource)?;
            if recognized_title && title.is_none() {
                title = Some(value.into_owned());
            } else if recognized_note && note.is_none() {
                note = optional_text(&value, 10_000);
            }
        } else {
            state.ignored_attribute_count = state.ignored_attribute_count.saturating_add(1);
        }
    }
    let title = title.as_deref().map_or_else(
        || {
            state.unnamed_count = state.unnamed_count.saturating_add(1);
            "未命名节点".to_owned()
        },
        |value| sanitize_title(value, 200, "未命名节点"),
    );
    Ok(MindMapDraftNode {
        title,
        note_markdown: note,
        children: Vec::new(),
    })
}

fn sanitize_title(value: &str, maximum: usize, fallback: &str) -> String {
    let value = value.trim();
    if value.is_empty() {
        return fallback.to_owned();
    }
    value.chars().take(maximum).collect()
}

fn optional_text(value: &str, maximum: usize) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.chars().take(maximum).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opml_nested_outline_becomes_one_typed_tree() {
        let source = MindMapSource {
            document_id: "019f7328-4b66-7613-9729-e3570fc41525".to_owned(),
            title: "408 大纲".to_owned(),
            mime_type: "text/x-opml".to_owned(),
            bytes: r#"<?xml version="1.0"?><opml><body><outline text="408"><outline text="数据结构"/><outline text="计组"/></outline></body></opml>"#.as_bytes().to_vec(),
        };

        let parsed = parse_mindmap_source(&source).expect("valid OPML should parse");

        assert_eq!(parsed.node_count, 3);
        assert_eq!(parsed.tree.title, "408");
        assert_eq!(parsed.tree.children[0].title, "数据结构");
    }

    #[test]
    fn freemind_nodes_preserve_nested_titles() {
        let source = MindMapSource {
            document_id: "019f7328-4b66-7613-9729-e3570fc41525".to_owned(),
            title: "数学".to_owned(),
            mime_type: "application/x-freemind".to_owned(),
            bytes: r#"<map><node TEXT="数学"><node TEXT="高数"/></node></map>"#
                .as_bytes()
                .to_vec(),
        };

        let parsed = parse_mindmap_source(&source).expect("valid FreeMind should parse");

        assert_eq!(parsed.source_format, "freemind");
        assert_eq!(parsed.tree.children[0].title, "高数");
    }

    #[test]
    fn doctype_is_rejected_before_formal_data_exists() {
        let source = MindMapSource {
            document_id: "019f7328-4b66-7613-9729-e3570fc41525".to_owned(),
            title: "不安全".to_owned(),
            mime_type: "text/x-opml".to_owned(),
            bytes: br#"<!DOCTYPE opml [<!ENTITY x SYSTEM "file:///secret">]><opml><body><outline text="&x;"/></body></opml>"#.to_vec(),
        };

        assert!(parse_mindmap_source(&source).is_err());
    }
}
