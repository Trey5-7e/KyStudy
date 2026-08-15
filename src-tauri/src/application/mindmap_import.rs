use std::io::{Cursor, Read};

use quick_xml::XmlVersion;
use quick_xml::events::{BytesStart, Event};
use quick_xml::reader::Reader;
use serde_json::Value;
use zip::ZipArchive;
use zip::result::ZipError;

use super::mindmap::KnowledgeError;
use super::resource::MindMapSource;
use crate::domain::MindMapDraftNode;

const MAX_IMPORT_NODES: u32 = 2_000;
const MAX_IMPORT_DEPTH: usize = 32;
const MAX_XMIND_CONTENT_BYTES: u64 = super::mindmap::MAX_MINDMAP_SOURCE_BYTES;

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
        "application/x-xmind" => return parse_xmind_source(source),
        _ => return Err(KnowledgeError::UnsupportedFormat),
    };
    parse_xml_tree(source, format)
}

fn parse_xmind_source(source: &MindMapSource) -> Result<ParsedMindMap, KnowledgeError> {
    if let Some(content) = read_xmind_entry(&source.bytes, "content.json")? {
        return parse_xmind_json(source, &content);
    }
    if let Some(content) = read_xmind_entry(&source.bytes, "content.xml")? {
        return parse_xmind_xml(source, &content);
    }
    Err(KnowledgeError::InvalidImportSource)
}

fn read_xmind_entry(bytes: &[u8], name: &str) -> Result<Option<Vec<u8>>, KnowledgeError> {
    let mut archive =
        ZipArchive::new(Cursor::new(bytes)).map_err(|_| KnowledgeError::InvalidImportSource)?;
    let mut entry = match archive.by_name(name) {
        Ok(entry) => entry,
        Err(ZipError::FileNotFound) => return Ok(None),
        Err(_) => return Err(KnowledgeError::InvalidImportSource),
    };
    if entry.size() > MAX_XMIND_CONTENT_BYTES {
        return Err(KnowledgeError::ImportLimitExceeded);
    }
    let capacity =
        usize::try_from(entry.size()).map_err(|_| KnowledgeError::ImportLimitExceeded)?;
    let mut content = Vec::with_capacity(capacity);
    entry
        .read_to_end(&mut content)
        .map_err(|_| KnowledgeError::InvalidImportSource)?;
    if content.len() > capacity {
        return Err(KnowledgeError::ImportLimitExceeded);
    }
    Ok(Some(content))
}

fn parse_xmind_json(
    source: &MindMapSource,
    content: &[u8],
) -> Result<ParsedMindMap, KnowledgeError> {
    let document: Value =
        serde_json::from_slice(content).map_err(|_| KnowledgeError::InvalidImportSource)?;
    let sheets = match &document {
        Value::Array(sheets) => sheets.iter().collect::<Vec<_>>(),
        Value::Object(object) => {
            if let Some(sheets) = object.get("sheets").and_then(Value::as_array) {
                sheets.iter().collect::<Vec<_>>()
            } else {
                vec![&document]
            }
        }
        _ => return Err(KnowledgeError::InvalidImportSource),
    };
    let mut state = ParseState::new();
    for sheet in &sheets {
        let root = sheet
            .get("rootTopic")
            .or_else(|| sheet.get("topic"))
            .ok_or(KnowledgeError::InvalidImportSource)?;
        let parsed = parse_json_topic(root, &mut state, 0)?;
        state.roots.push(parsed);
    }
    if state.roots.is_empty() {
        return Err(KnowledgeError::InvalidImportSource);
    }
    let mut warnings =
        vec!["XMind 的主题样式、关系线和附件未导入，仅保留节点层级与标题。".to_owned()];
    if sheets.len() > 1 {
        warnings.push(format!(
            "XMind 文件包含 {} 个画布，已合并到同一张导图。",
            sheets.len()
        ));
    }
    finalize_tree(source, "xmind", state, &mut warnings)
}

fn parse_json_topic(
    value: &Value,
    state: &mut ParseState,
    depth: usize,
) -> Result<MindMapDraftNode, KnowledgeError> {
    if depth >= MAX_IMPORT_DEPTH {
        return Err(KnowledgeError::ImportLimitExceeded);
    }
    let object = value
        .as_object()
        .ok_or(KnowledgeError::InvalidImportSource)?;
    state.increment_nodes()?;
    let title = object
        .get("title")
        .or_else(|| object.get("topic"))
        .and_then(Value::as_str)
        .map_or_else(
            || {
                state.unnamed_count = state.unnamed_count.saturating_add(1);
                "未命名节点".to_owned()
            },
            |value| sanitize_title(value, 200, "未命名节点"),
        );
    let children = object.get("children").map_or_else(
        || Ok(Vec::new()),
        |children| {
            let attached = children
                .as_object()
                .and_then(|value| value.get("attached"))
                .or_else(|| children.as_array().map(|_| children));
            let Some(attached) = attached else {
                return Ok(Vec::new());
            };
            attached
                .as_array()
                .ok_or(KnowledgeError::InvalidImportSource)?
                .iter()
                .map(|child| parse_json_topic(child, state, depth + 1))
                .collect()
        },
    )?;
    Ok(MindMapDraftNode {
        title,
        note_markdown: None,
        children,
    })
}

fn parse_xmind_xml(
    source: &MindMapSource,
    content: &[u8],
) -> Result<ParsedMindMap, KnowledgeError> {
    let mut reader = Reader::from_reader(content);
    reader.config_mut().trim_text(true);
    let mut state = XmindXmlState::new();
    loop {
        match reader
            .read_event()
            .map_err(|_| KnowledgeError::InvalidImportSource)?
        {
            Event::Start(element) if element.local_name().as_ref() == b"topic" => {
                state.start_topic()?;
            }
            Event::Empty(element) if element.local_name().as_ref() == b"topic" => {
                state.start_topic()?;
                state.end_topic()?;
            }
            Event::Start(element)
                if element.local_name().as_ref() == b"title"
                    || element.local_name().as_ref() == b"text" =>
            {
                state.start_text(element.local_name().as_ref() == b"title")?;
            }
            Event::Text(text) => state.push_text(
                &text
                    .decode()
                    .map_err(|_| KnowledgeError::InvalidImportSource)?,
            ),
            Event::End(element) if element.local_name().as_ref() == b"title" => {
                state.end_text(true)?;
            }
            Event::End(element) if element.local_name().as_ref() == b"text" => {
                state.end_text(false)?;
            }
            Event::End(element) if element.local_name().as_ref() == b"topic" => {
                state.end_topic()?;
            }
            Event::DocType(_) => return Err(KnowledgeError::InvalidImportSource),
            Event::Eof => break,
            _ => {}
        }
    }
    if !state.stack.is_empty() || state.roots.is_empty() {
        return Err(KnowledgeError::InvalidImportSource);
    }
    let mut warnings =
        vec!["XMind 的主题样式、关系线和附件未导入，仅保留节点层级与标题。".to_owned()];
    finalize_tree(source, "xmind", state.into_parse_state(), &mut warnings)
}

struct XmindXmlNode {
    title: Option<String>,
    children: Vec<MindMapDraftNode>,
}

struct XmindXmlState {
    stack: Vec<XmindXmlNode>,
    roots: Vec<MindMapDraftNode>,
    node_count: u32,
    unnamed_count: u32,
    text_is_title: Option<bool>,
    text: String,
}

impl XmindXmlState {
    fn new() -> Self {
        Self {
            stack: Vec::new(),
            roots: Vec::new(),
            node_count: 0,
            unnamed_count: 0,
            text_is_title: None,
            text: String::new(),
        }
    }

    fn start_topic(&mut self) -> Result<(), KnowledgeError> {
        if self.stack.len() >= MAX_IMPORT_DEPTH {
            return Err(KnowledgeError::ImportLimitExceeded);
        }
        self.node_count = self
            .node_count
            .checked_add(1)
            .ok_or(KnowledgeError::ImportLimitExceeded)?;
        if self.node_count > MAX_IMPORT_NODES {
            return Err(KnowledgeError::ImportLimitExceeded);
        }
        self.stack.push(XmindXmlNode {
            title: None,
            children: Vec::new(),
        });
        Ok(())
    }

    fn start_text(&mut self, is_title: bool) -> Result<(), KnowledgeError> {
        if self.stack.is_empty() || self.text_is_title.is_some() {
            return Err(KnowledgeError::InvalidImportSource);
        }
        self.text_is_title = Some(is_title);
        self.text.clear();
        Ok(())
    }

    fn push_text(&mut self, text: &str) {
        if self.text_is_title.is_some() {
            self.text.push_str(text);
        }
    }

    fn end_text(&mut self, is_title: bool) -> Result<(), KnowledgeError> {
        if self.text_is_title != Some(is_title) {
            return Err(KnowledgeError::InvalidImportSource);
        }
        if is_title && let Some(node) = self.stack.last_mut() {
            node.title = Some(self.text.clone());
        }
        self.text_is_title = None;
        self.text.clear();
        Ok(())
    }

    fn end_topic(&mut self) -> Result<(), KnowledgeError> {
        if self.text_is_title.is_some() {
            return Err(KnowledgeError::InvalidImportSource);
        }
        let node = self
            .stack
            .pop()
            .ok_or(KnowledgeError::InvalidImportSource)?;
        let title = node.title.as_deref().map_or_else(
            || {
                self.unnamed_count = self.unnamed_count.saturating_add(1);
                "未命名节点".to_owned()
            },
            |value| sanitize_title(value, 200, "未命名节点"),
        );
        let parsed = MindMapDraftNode {
            title,
            note_markdown: None,
            children: node.children,
        };
        if let Some(parent) = self.stack.last_mut() {
            parent.children.push(parsed);
        } else {
            self.roots.push(parsed);
        }
        Ok(())
    }

    fn into_parse_state(self) -> ParseState {
        ParseState {
            stack: Vec::new(),
            roots: self.roots,
            node_count: self.node_count,
            unnamed_count: self.unnamed_count,
            ignored_attribute_count: 0,
        }
    }
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

    finalize_tree(source, format.token(), state, &mut Vec::new())
}

fn finalize_tree(
    source: &MindMapSource,
    source_format: &str,
    mut state: ParseState,
    warnings: &mut Vec<String>,
) -> Result<ParsedMindMap, KnowledgeError> {
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
        source_format: source_format.to_owned(),
        title,
        tree,
        warnings: warnings.clone(),
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
    use std::io::Write;

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

    #[test]
    fn xmind_json_archive_becomes_a_typed_draft_tree() {
        let mut bytes = Cursor::new(Vec::new());
        {
            let mut archive = zip::ZipWriter::new(&mut bytes);
            archive
                .start_file("content.json", zip::write::SimpleFileOptions::default())
                .expect("content entry should start");
            archive
                .write_all(
                    br#"[{"title":"canvas","rootTopic":{"title":"root","children":{"attached":[{"title":"child"}]}}}]"#,
                )
                .expect("content entry should write");
            archive.finish().expect("archive should finish");
        }
        let source = MindMapSource {
            document_id: "019f7328-4b66-7613-9729-e3570fc41525".to_owned(),
            title: "XMind 示例".to_owned(),
            mime_type: "application/x-xmind".to_owned(),
            bytes: bytes.into_inner(),
        };

        let parsed = parse_mindmap_source(&source).expect("valid XMind should parse");

        assert_eq!(parsed.source_format, "xmind");
        assert_eq!(parsed.node_count, 2);
        assert_eq!(parsed.tree.title, "root");
        assert_eq!(parsed.tree.children[0].title, "child");
    }

    #[test]
    fn xmind_xml_archive_becomes_a_typed_draft_tree() {
        let mut bytes = Cursor::new(Vec::new());
        {
            let mut archive = zip::ZipWriter::new(&mut bytes);
            archive
                .start_file("content.xml", zip::write::SimpleFileOptions::default())
                .expect("content entry should start");
            archive
                .write_all(
                    br"<xmap-content><sheet><topic><title>root</title><children><topics><topic><title>child</title></topic></topics></children></topic></sheet></xmap-content>",
                )
                .expect("content entry should write");
            archive.finish().expect("archive should finish");
        }
        let source = MindMapSource {
            document_id: "019f7328-4b66-7613-9729-e3570fc41525".to_owned(),
            title: "XMind XML 示例".to_owned(),
            mime_type: "application/x-xmind".to_owned(),
            bytes: bytes.into_inner(),
        };

        let parsed = parse_mindmap_source(&source).expect("valid XMind XML should parse");

        assert_eq!(parsed.source_format, "xmind");
        assert_eq!(parsed.node_count, 2);
        assert_eq!(parsed.tree.children[0].title, "child");
    }
}
