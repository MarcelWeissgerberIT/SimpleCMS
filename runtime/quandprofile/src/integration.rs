//! Stateless IPC: compile a trusted gate, verify fresh state, return evidence.
//! This process does not execute application writes or send provider data.
use crate::{
    adapters::{AtlasReviewSnapshot, OneMcpSnapshot, OneProviderSnapshot},
    digest, Evaluation, EvidenceQuantum, Files, QuandProfile, QuantumCatalog, Runtime, Status,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Scope {
    pub workspace: String,
    pub target: String,
    pub actor: String,
    pub state_revision: String,
    pub operation_digest: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "gate", rename_all = "snake_case", deny_unknown_fields)]
pub enum Request {
    AtlasReview {
        scope: Scope,
        snapshot: AtlasReviewSnapshot,
    },
    OneProvider {
        scope: Scope,
        snapshot: OneProviderSnapshot,
    },
    OneMcp {
        scope: Scope,
        snapshot: OneMcpSnapshot,
    },
}

#[derive(Debug, Serialize)]
pub struct Response {
    pub protocol: String,
    pub request_digest: String,
    pub decision: String,
    pub scope: Scope,
    pub profile: QuandProfile,
    pub evaluation: Evaluation,
    pub quanta: Vec<EvidenceQuantum>,
}

pub fn check(request: Request, catalog: &QuantumCatalog) -> Result<Response, String> {
    let request_digest = digest(&request);
    let (kind, scope, snapshot) = match request {
        Request::AtlasReview { scope, snapshot } => (
            "atlas_review_fresh",
            scope,
            serde_json::to_string(&snapshot).map_err(|e| e.to_string())?,
        ),
        Request::OneProvider { scope, snapshot } => (
            "one_provider_allowed",
            scope,
            serde_json::to_string(&snapshot).map_err(|e| e.to_string())?,
        ),
        Request::OneMcp { scope, snapshot } => (
            "one_mcp_allowed",
            scope,
            serde_json::to_string(&snapshot).map_err(|e| e.to_string())?,
        ),
    };
    if [
        &scope.workspace,
        &scope.target,
        &scope.actor,
        &scope.state_revision,
        &scope.operation_digest,
    ]
    .iter()
    .any(|s| s.trim().is_empty())
    {
        return Err("Host scope fields must be nonempty".into());
    }
    let profile = QuandProfile::compile_gate(
        kind,
        &serde_json::to_string(&scope).map_err(|e| e.to_string())?,
        1,
        catalog,
    )?;
    let files: Files = [("host-snapshot.json".into(), snapshot)].into();
    let mut runtime = Runtime::new(profile.clone(), files)?;
    let evaluation = runtime.verify();
    let decision = if evaluation.status == Status::Verified {
        "allow"
    } else {
        "block"
    }
    .into();
    Ok(Response {
        protocol: "quandprofile.gate.v1".into(),
        request_digest,
        decision,
        scope,
        profile,
        evaluation,
        quanta: runtime.ledger().to_vec(),
    })
}
