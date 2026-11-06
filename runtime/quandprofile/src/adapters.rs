//! Host-supplied normalized snapshots; never accept these from model/tool arguments.
use crate::Status;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Review {
    pub verdict: String,
    pub commit_sha: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AtlasReviewSnapshot {
    pub head_sha: String,
    /// Only linked, undeleted reviews of the authorized item, loaded by the host.
    pub linked_reviews: Vec<Review>,
}

pub fn atlas_review(snapshot: &AtlasReviewSnapshot) -> (Status, String) {
    let approved: Vec<_> = snapshot
        .linked_reviews
        .iter()
        .filter(|r| r.verdict.trim() == "approve" && !r.commit_sha.trim().is_empty())
        .collect();
    if approved.is_empty() {
        return (Status::Violated, "review-missing".into());
    }
    let head = snapshot.head_sha.trim();
    if head.is_empty() {
        return (Status::Violated, "review-head-missing".into());
    }
    if !approved
        .iter()
        .any(|r| r.commit_sha.trim().eq_ignore_ascii_case(head))
    {
        return (Status::Violated, "review-stale".into());
    }
    (
        Status::Verified,
        "Linked approve verdict matches recorded head SHA".into(),
    )
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProviderRule {
    pub allow: BTreeSet<String>,
    pub forbid: BTreeSet<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OneProviderSnapshot {
    pub provider: String,
    pub classes: BTreeSet<String>,
    pub provider_rule: Option<ProviderRule>,
    pub device_allow: BTreeSet<String>,
    pub device_narrow: BTreeSet<String>,
    pub member_classes_owned_by_member: bool,
    #[serde(default)]
    pub allowed_destinations: Option<BTreeSet<String>>,
}

const SHARED: &[&str] = &[
    "public",
    "structure",
    "selection",
    "page",
    "rows",
    "files",
    "workspace",
    "people",
    "transcript",
];
const MEMBER: &[&str] = &["private", "mail", "memory", "mcp"];

pub fn one_provider(snapshot: &OneProviderSnapshot) -> (Status, String) {
    if ![
        "anthropic",
        "openai",
        "openrouter",
        "local",
        "ollama",
        "minimax",
        "codex",
        "copilot",
    ]
    .contains(&snapshot.provider.as_str())
    {
        return (Status::Open, "Unknown provider".into());
    }
    if snapshot
        .allowed_destinations
        .as_ref()
        .is_some_and(|set| !set.contains(&snapshot.provider))
    {
        return (Status::Violated, "Provider destination denied".into());
    }
    let mut all: Vec<&String> = snapshot
        .classes
        .iter()
        .chain(snapshot.device_allow.iter())
        .chain(snapshot.device_narrow.iter())
        .collect();
    if let Some(rule) = &snapshot.provider_rule {
        all.extend(rule.allow.iter().chain(rule.forbid.iter()));
    }
    if all
        .iter()
        .any(|c| !SHARED.contains(&c.as_str()) && !MEMBER.contains(&c.as_str()))
    {
        return (Status::Open, "Unknown data class".into());
    }
    let allowed = |class: &String| {
        if snapshot.device_narrow.contains(class) {
            return false;
        }
        let claude_open = snapshot.provider == "anthropic" && snapshot.provider_rule.is_none();
        if SHARED.contains(&class.as_str()) {
            return claude_open
                || snapshot
                    .provider_rule
                    .as_ref()
                    .is_some_and(|r| r.allow.contains(class));
        }
        if snapshot
            .provider_rule
            .as_ref()
            .is_some_and(|r| r.forbid.contains(class))
        {
            return false;
        }
        if !snapshot.member_classes_owned_by_member {
            return claude_open
                || snapshot
                    .provider_rule
                    .as_ref()
                    .is_some_and(|r| r.allow.contains(class));
        }
        snapshot.provider == "anthropic" || snapshot.device_allow.contains(class)
    };
    let refused: Vec<_> = snapshot.classes.iter().filter(|c| !allowed(c)).collect();
    if refused.is_empty() {
        (
            Status::Verified,
            "All declared classes allowed for selected provider".into(),
        )
    } else {
        (
            Status::Violated,
            format!(
                "Refused classes: {}",
                refused
                    .iter()
                    .map(|c| c.as_str())
                    .collect::<Vec<_>>()
                    .join(",")
            ),
        )
    }
}

/// The host binds this snapshot to the exact tool invocation. No tokens or source bodies.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OneMcpSnapshot {
    pub origin: String,
    pub allowed_origins: Option<BTreeSet<String>>,
    pub tool: String,
    pub allowed_tools: Option<BTreeSet<String>>,
    pub denied_tools: BTreeSet<String>,
    pub target_ref: Option<u64>,
    pub observed_refs: BTreeSet<u64>,
}

pub fn one_mcp(s: &OneMcpSnapshot) -> (Status, String) {
    if s.tool.is_empty() || s.origin.is_empty() {
        return (Status::Open, "Tool/origin missing".into());
    }
    if s.allowed_origins
        .as_ref()
        .is_some_and(|set| !set.contains(&s.origin))
        || s.allowed_tools
            .as_ref()
            .is_some_and(|set| !set.contains(&s.tool))
        || s.denied_tools.contains(&s.tool)
    {
        return (Status::Violated, "MCP destination or tool denied".into());
    }
    if [
        "atlas_update",
        "atlas_comment",
        "atlas_log_work",
        "atlas_delete",
        "atlas_attach",
        "atlas_attach_link",
        "atlas_sprint_commit",
    ]
    .contains(&s.tool.as_str())
    {
        if let Some(target) = s.target_ref {
            if !s.observed_refs.contains(&target) {
                return (
                    Status::Violated,
                    "Read exact target first; write not executed".into(),
                );
            }
        }
    }
    (
        Status::Verified,
        "Selected MCP tool and target satisfy dispatch rules".into(),
    )
}
