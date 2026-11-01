//! QuandProfile: scoped specifications with locally issued, dependency-bound evidence.
//! Hashes bind artifacts; they are not signatures or proof of semantic correctness.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

pub mod adapters;
pub mod catalog;
pub mod integration;
#[cfg(target_arch = "wasm32")]
mod wasm;
pub use catalog::{DimensionDefinition, QuantumBinding, QuantumCatalog};

pub type Files = BTreeMap<String, String>;

fn digest<T: Serialize>(value: &T) -> String {
    format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(value).expect("serializable value"))
    )
}

#[derive(Debug, Clone, Deserialize)]
pub struct Contract {
    pub version: u64,
    pub goals: Vec<String>,
    pub rules: Vec<Rule>,
    #[serde(default)]
    pub unresolved: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Rule {
    pub id: String,
    pub kind: String,
    pub source_id: String,
    pub source_text: String,
}

/// Host-defined acceptance criterion, not an inferred interpretation of "revise".
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResultSpec {
    pub path: String,
    pub literal: String,
}

pub type Dimension = String;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Check {
    AtlasReviewFresh { path: String },
    OneProviderAllowed { path: String },
    OneMcpAllowed { path: String },
    PricesEqual { path: String },
    LiteralPresent { path: String, literal: String },
    PublishUnavailable,
    Unresolved { reason: String },
}

#[derive(Debug, Clone, Serialize)]
pub struct ProofObligation {
    pub id: String,
    pub dimensions: BTreeSet<Dimension>,
    pub required: bool,
    pub claim: String,
    pub source: String,
    pub quantum_binding: Option<QuantumBinding>,
    check: Check,
}

#[derive(Debug, Clone, Serialize)]
pub struct QuandProfile {
    pub schema_version: u32,
    pub contract_version: u64,
    pub dimension_definitions: Vec<DimensionDefinition>,
    obligations: Vec<ProofObligation>,
}

impl QuandProfile {
    pub fn compile(contract: &Contract, result: Option<ResultSpec>) -> Result<Self, String> {
        Self::compile_with_catalog(contract, result, &QuantumCatalog::builtin())
    }

    pub fn compile_with_catalog(
        contract: &Contract,
        result: Option<ResultSpec>,
        catalog: &QuantumCatalog,
    ) -> Result<Self, String> {
        catalog.validate()?;
        let mut obligations = Vec::new();
        let mut ids = BTreeSet::new();
        for rule in &contract.rules {
            if rule.id.is_empty() || !ids.insert(rule.id.clone()) {
                return Err("Empty or duplicate rule ID".into());
            }
            let (dimensions, claim, check, quantum_binding) = match catalog
                .select(&format!("rule:{}", rule.kind))
            {
                Some(definition) => {
                    let (dimensions, claim, check, binding) = definition.bind(None)?;
                    (dimensions, claim, check, Some(binding))
                }
                None => (
                    BTreeSet::from(["interpretation".into()]),
                    "rule_requires_interpretation".into(),
                    Check::Unresolved {
                        reason: format!("No matching quantum definition for rule: {}", rule.kind),
                    },
                    None,
                ),
            };
            obligations.push(ProofObligation {
                id: format!("rule:{}", rule.id),
                dimensions,
                required: true,
                claim: claim.into(),
                source: format!("{}: {}", rule.source_id, rule.source_text),
                quantum_binding,
                check,
            });
        }
        for (index, unresolved) in contract.unresolved.iter().enumerate() {
            obligations.push(ProofObligation {
                id: format!("unresolved:{index}"),
                dimensions: BTreeSet::from(["interpretation".into()]),
                required: true,
                claim: "instruction_requires_interpretation".into(),
                source: unresolved.to_string(),
                quantum_binding: None,
                check: Check::Unresolved {
                    reason: "Compiler left an instruction unresolved".into(),
                },
            });
        }
        let has_goal = contract.goals.len() == 1 && contract.goals[0] == "revise_website";
        let (dimensions, check, quantum_binding) = match (result.as_ref(), has_goal, catalog.select("goal:revise_website")) {
            (Some(spec), true, Some(definition)) => {
                let (dimensions, _, check, binding) = definition.bind(Some(spec))?;
                (dimensions, check, Some(binding))
            }
            _ => (BTreeSet::from(["interpretation".into()]), Check::Unresolved {
                reason: "Goal needs a matching quantum definition and an explicit host acceptance criterion".into(),
            }, None),
        };
        obligations.push(ProofObligation {
            id: "outcome:website".into(),
            dimensions,
            required: true,
            claim: "specified_literal_present_in_target_file".into(),
            source: "contract goal + explicit host ResultSpec (not inferred)".into(),
            quantum_binding,
            check,
        });
        let used: BTreeSet<_> = obligations
            .iter()
            .flat_map(|o| o.dimensions.iter().cloned())
            .collect();
        let mut dimension_definitions: Vec<_> = catalog
            .dimensions()
            .iter()
            .filter(|d| used.contains(&d.id))
            .cloned()
            .collect();
        dimension_definitions.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(Self {
            schema_version: 3,
            contract_version: contract.version,
            dimension_definitions,
            obligations,
        })
    }

    pub fn fingerprint(&self) -> String {
        digest(self)
    }
    pub fn obligations(&self) -> &[ProofObligation] {
        &self.obligations
    }

    /// Compile a host-owned application gate without inventing a website goal.
    pub fn compile_gate(
        kind: &str,
        source: &str,
        version: u64,
        catalog: &QuantumCatalog,
    ) -> Result<Self, String> {
        catalog.validate()?;
        let definition = catalog
            .select(&format!("rule:{kind}"))
            .ok_or("No quantum for application gate")?;
        let (dimensions, claim, check, binding) = definition.bind(None)?;
        let dimension_definitions = catalog
            .dimensions()
            .iter()
            .filter(|d| dimensions.contains(&d.id))
            .cloned()
            .collect();
        Ok(Self {
            schema_version: 3,
            contract_version: version,
            dimension_definitions,
            obligations: vec![ProofObligation {
                id: format!("gate:{kind}"),
                dimensions,
                required: true,
                claim,
                source: source.into(),
                quantum_binding: Some(binding),
                check,
            }],
        })
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Verified,
    Violated,
    Open,
}

#[derive(Debug, Clone, Serialize)]
pub struct EvidenceQuantum {
    pub id: String,
    pub obligation_id: String,
    pub dimensions: BTreeSet<Dimension>,
    pub profile_hash: String,
    pub verifier: String,
    pub verifier_version: String,
    pub quantum_binding: Option<QuantumBinding>,
    pub dependencies: BTreeMap<String, String>,
    pub result: Status,
    pub detail: String,
}

#[derive(Debug, Serialize)]
pub struct Finding {
    pub obligation_id: String,
    pub status: Status,
    pub quantum_id: Option<String>,
    pub reason: String,
}

#[derive(Debug, Serialize)]
pub struct Evaluation {
    pub profile_hash: String,
    pub status: Status,
    pub findings: Vec<Finding>,
    pub dimensions: Vec<DimensionEvaluation>,
}

#[derive(Debug, Serialize)]
pub struct DimensionEvaluation {
    pub dimension_id: Dimension,
    pub status: Status,
    pub obligation_ids: Vec<String>,
}

fn safe_path(path: &str) -> Result<(), String> {
    if path.is_empty()
        || path.contains(['\\', '\0', ':'])
        || path
            .split('/')
            .any(|p| p.is_empty() || p == "." || p == "..")
    {
        return Err("Path must be canonical and project-relative".into());
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Product {
    id: String,
    name: String,
    price: u64,
}

fn prices(content: &str) -> Result<BTreeMap<String, u64>, String> {
    let products: Vec<Product> = serde_json::from_str(content).map_err(|e| e.to_string())?;
    let mut result = BTreeMap::new();
    for p in products {
        if p.id.is_empty() || p.name.is_empty() || result.insert(p.id, p.price).is_some() {
            return Err("Invalid or duplicate product".into());
        }
    }
    Ok(result)
}

/// Only these actions exist. Neither shell nor publication can be executed.
#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum Action {
    ReadFile {
        contract_version: u64,
        path: String,
    },
    ProposePatch {
        contract_version: u64,
        changes: Files,
    },
    Finish {
        contract_version: u64,
    },
}

#[derive(Debug, Serialize)]
pub struct Event {
    pub action: String,
    pub accepted: bool,
    pub detail: String,
}

/// Host-owned memory. The model receives serialized context, never object access.
pub struct Runtime {
    profile: QuandProfile,
    baseline: Files,
    files: Files,
    ledger: Vec<EvidenceQuantum>,
    events: Vec<Event>,
    finished: bool,
}

impl Runtime {
    pub fn new(profile: QuandProfile, baseline: Files) -> Result<Self, String> {
        for path in baseline.keys() {
            safe_path(path)?;
        }
        Ok(Self {
            profile,
            files: baseline.clone(),
            baseline,
            ledger: Vec::new(),
            events: Vec::new(),
            finished: false,
        })
    }
    pub fn profile(&self) -> &QuandProfile {
        &self.profile
    }
    pub fn files(&self) -> &Files {
        &self.files
    }
    pub fn ledger(&self) -> &[EvidenceQuantum] {
        &self.ledger
    }
    pub fn events(&self) -> &[Event] {
        &self.events
    }
    pub fn finished(&self) -> bool {
        self.finished
    }

    /// Compact model-facing specification. The host still has to budget this
    /// packet with the real tokenizer and attach the necessary file evidence.
    pub fn work_context(&self) -> serde_json::Value {
        let evaluation = self.evaluate();
        let requirements: Vec<_> = self
            .profile
            .obligations()
            .iter()
            .zip(evaluation.findings.iter())
            .map(|(obligation, finding)| {
                serde_json::json!({
                    "id": obligation.id, "dimensions": obligation.dimensions,
                    "required": obligation.required, "claim": obligation.claim,
                    "check": obligation.check, "status": finding.status,
                    "quantum_binding": obligation.quantum_binding
                })
            })
            .collect();
        serde_json::json!({
            "contract_version": self.profile.contract_version,
            "profile_hash": evaluation.profile_hash,
            "requirements": requirements,
            "allowed_actions": if self.finished { Vec::<&str>::new() }
                else { vec!["read_file", "propose_patch", "finish"] },
            "protocol": "Return one JSON action with contract_version. Only the host can issue evidence."
        })
    }

    fn dependencies(&self, obligation: &ProofObligation) -> BTreeMap<String, String> {
        let mut deps = BTreeMap::new();
        match &obligation.check {
            Check::AtlasReviewFresh { path }
            | Check::OneProviderAllowed { path }
            | Check::OneMcpAllowed { path } => {
                deps.insert(
                    format!("host_snapshot:{path}"),
                    digest(&self.files.get(path)),
                );
            }
            Check::PricesEqual { path } => {
                deps.insert(format!("baseline:{path}"), digest(&self.baseline.get(path)));
                deps.insert(format!("current:{path}"), digest(&self.files.get(path)));
            }
            Check::LiteralPresent { path, .. } => {
                deps.insert(format!("current:{path}"), digest(&self.files.get(path)));
            }
            Check::PublishUnavailable => {
                // A narrowly scoped capability fact, not proof of deployment history.
                deps.insert(
                    "runtime:capabilities".into(),
                    digest(&"read_file,propose_patch,finish:v1"),
                );
            }
            Check::Unresolved { .. } => {}
        }
        deps
    }

    fn check(&self, obligation: &ProofObligation) -> (Status, String, String) {
        match &obligation.check {
            Check::OneMcpAllowed { path } => {
                let result = self.files.get(path).ok_or("Snapshot missing".to_string())
                    .and_then(|s| serde_json::from_str::<adapters::OneMcpSnapshot>(s).map_err(|e| e.to_string()));
                let (status,detail)=result.map_or_else(|e|(Status::Open,e),|s|adapters::one_mcp(&s));
                (status,detail,"one_mcp_allowed".into())
            }
            Check::AtlasReviewFresh { path } => {
                let result = self.files.get(path).ok_or("Snapshot missing".to_string())
                    .and_then(|s| serde_json::from_str::<adapters::AtlasReviewSnapshot>(s).map_err(|e| e.to_string()));
                let (status, detail) = result.map_or_else(|e| (Status::Open,e), |s| adapters::atlas_review(&s));
                (status,detail,"atlas_review_fresh".into())
            }
            Check::OneProviderAllowed { path } => {
                let result = self.files.get(path).ok_or("Snapshot missing".to_string())
                    .and_then(|s| serde_json::from_str::<adapters::OneProviderSnapshot>(s).map_err(|e| e.to_string()));
                let (status, detail) = result.map_or_else(|e| (Status::Open,e), |s| adapters::one_provider(&s));
                (status,detail,"one_provider_allowed".into())
            }
            Check::PricesEqual { path } => {
                match (self.baseline.get(path), self.files.get(path)) {
                    (Some(before), Some(after)) => match (prices(before), prices(after)) {
                        (Ok(a), Ok(b)) => (if a == b { Status::Verified } else { Status::Violated },
                            "Compare complete product-ID to integer-cent maps".into(), "price_map_equal".into()),
                        (Err(e), _) => (Status::Open, format!("Baseline invalid: {e}"), "price_map_equal".into()),
                        (_, Err(e)) => (Status::Violated, format!("Candidate invalid: {e}"), "price_map_equal".into()),
                    },
                    _ => (Status::Open, "Required catalog missing".into(), "price_map_equal".into()),
                }
            }
            Check::LiteralPresent { path, literal } => match self.files.get(path) {
                Some(content) => (if content.contains(literal) { Status::Verified } else { Status::Violated },
                    "Literal substring check only; does not validate rendered HTML".into(), "literal_present".into()),
                None => (Status::Open, "Target file missing".into(), "literal_present".into()),
            },
            Check::PublishUnavailable => (Status::Verified,
                "This in-memory runtime exposes no publish or shell action; no claim about external actors".into(),
                "capability_set".into()),
            Check::Unresolved { reason } => (Status::Open, reason.clone(), "unresolved".into()),
        }
    }

    /// Re-check all obligations with registered verifiers. No external evidence ingestion.
    pub fn verify(&mut self) -> Evaluation {
        for obligation in self.profile.obligations() {
            let (result, detail, verifier) = self.check(obligation);
            if result == Status::Open {
                continue;
            }
            let mut quantum = EvidenceQuantum {
                id: String::new(),
                obligation_id: obligation.id.clone(),
                dimensions: obligation.dimensions.clone(),
                profile_hash: self.profile.fingerprint(),
                verifier,
                verifier_version: "1.0.0".into(),
                quantum_binding: obligation.quantum_binding.clone(),
                dependencies: self.dependencies(obligation),
                result,
                detail,
            };
            quantum.id = digest(&quantum);
            if !self.ledger.iter().any(|q| q.id == quantum.id) {
                self.ledger.push(quantum);
            }
        }
        self.evaluate()
    }

    /// Evaluate existing local evidence. Stale or missing evidence remains open.
    pub fn evaluate(&self) -> Evaluation {
        let profile_hash = self.profile.fingerprint();
        let mut status = Status::Verified;
        let mut findings = Vec::new();
        for obligation in self.profile.obligations() {
            let deps = self.dependencies(obligation);
            let quantum = self.ledger.iter().rev().find(|q| {
                q.profile_hash == profile_hash
                    && q.obligation_id == obligation.id
                    && q.dependencies == deps
            });
            let current = quantum.map_or(Status::Open, |q| q.result);
            if obligation.required {
                if current == Status::Violated {
                    status = Status::Violated;
                } else if current == Status::Open && status != Status::Violated {
                    status = Status::Open;
                }
            }
            findings.push(Finding {
                obligation_id: obligation.id.clone(),
                status: current,
                quantum_id: quantum.map(|q| q.id.clone()),
                reason: quantum.map_or_else(
                    || "Missing, unresolved, or stale evidence".into(),
                    |q| q.detail.clone(),
                ),
            });
        }
        let dimensions = self
            .profile
            .dimension_definitions
            .iter()
            .map(|definition| {
                let members: Vec<_> = self
                    .profile
                    .obligations()
                    .iter()
                    .zip(findings.iter())
                    .filter(|(o, _)| o.dimensions.contains(&definition.id))
                    .collect();
                let required: Vec<_> = members.iter().filter(|(o, _)| o.required).collect();
                let dimension_status = if required.iter().any(|(_, f)| f.status == Status::Violated)
                {
                    Status::Violated
                } else if required.is_empty()
                    || required.iter().any(|(_, f)| f.status == Status::Open)
                {
                    Status::Open
                } else {
                    Status::Verified
                };
                DimensionEvaluation {
                    dimension_id: definition.id.clone(),
                    status: dimension_status,
                    obligation_ids: members.iter().map(|(o, _)| o.id.clone()).collect(),
                }
            })
            .collect();
        Evaluation {
            profile_hash,
            status,
            findings,
            dimensions,
        }
    }

    /// Host may replace a profile; old evidence stays auditable but cannot satisfy a new hash.
    pub fn replace_profile(&mut self, profile: QuandProfile) -> Result<(), String> {
        if self.finished {
            return Err("Task already finished".into());
        }
        self.profile = profile;
        Ok(())
    }

    pub fn execute_json(&mut self, text: &str) -> Result<String, String> {
        let action: Action = match serde_json::from_str(text) {
            Ok(action) => action,
            Err(e) => {
                let detail = format!("Invalid action: {e}");
                self.events.push(Event {
                    action: "invalid".into(),
                    accepted: false,
                    detail: detail.clone(),
                });
                return Err(detail);
            }
        };
        let label = match &action {
            Action::ReadFile { .. } => "read_file",
            Action::ProposePatch { .. } => "propose_patch",
            Action::Finish { .. } => "finish",
        };
        let result = self.execute(action);
        self.events.push(Event {
            action: label.into(),
            accepted: result.is_ok(),
            detail: result.as_ref().cloned().unwrap_or_else(|e| e.clone()),
        });
        result
    }

    fn execute(&mut self, action: Action) -> Result<String, String> {
        if self.finished {
            return Err("Task already finished".into());
        }
        let version = match &action {
            Action::ReadFile {
                contract_version, ..
            }
            | Action::ProposePatch {
                contract_version, ..
            }
            | Action::Finish { contract_version } => *contract_version,
        };
        if version != self.profile.contract_version {
            return Err("Stale contract version".into());
        }
        if self
            .profile
            .obligations()
            .iter()
            .any(|o| matches!(o.check, Check::Unresolved { .. }))
        {
            return Err("Profile contains unresolved obligations".into());
        }
        match action {
            Action::ReadFile { path, .. } => {
                safe_path(&path)?;
                self.files
                    .get(&path)
                    .cloned()
                    .ok_or("Unknown project file".into())
            }
            Action::ProposePatch { changes, .. } => {
                if self.profile.obligations().iter().any(|o| {
                    matches!(
                        o.check,
                        Check::AtlasReviewFresh { .. } | Check::OneProviderAllowed { .. }
                    )
                }) {
                    return Err("Host snapshots cannot be changed through model actions".into());
                }
                if changes.is_empty() {
                    return Err("Empty patch".into());
                }
                let mut candidate = self.files.clone();
                for (path, content) in changes {
                    safe_path(&path)?;
                    if !candidate.contains_key(&path) {
                        return Err("Unknown project file".into());
                    }
                    candidate.insert(path, content);
                }
                for obligation in self.profile.obligations() {
                    if let Check::PricesEqual { path } = &obligation.check {
                        let before = self.baseline.get(path).ok_or("Missing price baseline")?;
                        let after = candidate.get(path).ok_or("Missing candidate catalog")?;
                        if prices(before)? != prices(after)? {
                            return Err("Price invariant violated".into());
                        }
                    }
                }
                self.files = candidate;
                Ok(
                    "Committed to isolated in-memory project; affected evidence is now stale"
                        .into(),
                )
            }
            Action::Finish { .. } => {
                let evaluation = self.verify();
                if evaluation.status != Status::Verified {
                    return Err(format!("Profile not fulfilled: {:?}", evaluation.status));
                }
                self.finished = true;
                Ok("All required obligations verified for this profile and state".into())
            }
        }
    }
}
