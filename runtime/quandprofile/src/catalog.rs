//! Independently authored templates. Executable verifiers remain trusted Rust code.
use crate::{digest, safe_path, Check, Dimension, ResultSpec};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum QuantumTemplate {
    AtlasReviewFresh,
    OneProviderAllowed,
    OneMcpAllowed,
    PricesEqual { path: String },
    LiteralPresent,
    PublishUnavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QuantumDefinition {
    pub id: String,
    pub version: String,
    pub selector: String,
    pub dimensions: BTreeSet<Dimension>,
    pub template: QuantumTemplate,
}

#[derive(Debug, Clone, Serialize)]
pub struct QuantumBinding {
    pub definition_id: String,
    pub definition_version: String,
    pub definition_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QuantumCatalog {
    dimensions: Vec<DimensionDefinition>,
    definitions: Vec<QuantumDefinition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DimensionDefinition {
    pub id: Dimension,
    pub title: String,
}

impl QuantumCatalog {
    pub fn from_json(text: &str) -> Result<Self, String> {
        let catalog: Self = serde_json::from_str(text).map_err(|e| e.to_string())?;
        catalog.validate()?;
        Ok(catalog)
    }

    pub fn builtin() -> Self {
        Self::from_json(include_str!("../quantum-catalog.json")).expect("valid embedded catalog")
    }

    pub fn definitions(&self) -> &[QuantumDefinition] {
        &self.definitions
    }

    pub fn dimensions(&self) -> &[DimensionDefinition] {
        &self.dimensions
    }

    pub(crate) fn validate(&self) -> Result<(), String> {
        let mut identities = BTreeSet::new();
        let mut selectors = BTreeSet::new();
        let mut dimension_ids = BTreeSet::new();
        for dimension in &self.dimensions {
            if dimension.id.is_empty()
                || !dimension
                    .id
                    .bytes()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_')
                || dimension.title.trim().is_empty()
                || !dimension_ids.insert(dimension.id.clone())
            {
                return Err("Invalid or duplicate dimension definition".into());
            }
        }
        if !dimension_ids.contains("interpretation") {
            return Err(
                "Catalog needs interpretation dimension for unresolved requirements".into(),
            );
        }
        for definition in &self.definitions {
            if definition.dimensions.is_empty() || !definition.dimensions.is_subset(&dimension_ids)
            {
                return Err("Quantum needs nonempty, registered dimensions".into());
            }
            let core = match definition.template {
                QuantumTemplate::AtlasReviewFresh => "freshness",
                QuantumTemplate::OneProviderAllowed => "privacy",
                QuantumTemplate::OneMcpAllowed => "permission",
                QuantumTemplate::PricesEqual { .. } => "data",
                QuantumTemplate::LiteralPresent => "outcome",
                QuantumTemplate::PublishUnavailable => "permission",
            };
            if !definition.dimensions.contains(core) {
                return Err(format!(
                    "Quantum must retain its verifier's core dimension: {core}"
                ));
            }
            if definition.id.trim().is_empty()
                || definition.version.trim().is_empty()
                || !identities.insert((&definition.id, &definition.version))
            {
                return Err("Missing or duplicate quantum identity".into());
            }
            if !selectors.insert(&definition.selector) {
                return Err(format!(
                    "Ambiguous quantum selection: {}",
                    definition.selector
                ));
            }
            // V1 pins exact semantic matches; approximate matches may never weaken a rule.
            let compatible = match (&definition.template, definition.selector.as_str()) {
                (QuantumTemplate::AtlasReviewFresh, "rule:atlas_review_fresh") => true,
                (QuantumTemplate::OneProviderAllowed, "rule:one_provider_allowed") => true,
                (QuantumTemplate::OneMcpAllowed, "rule:one_mcp_allowed") => true,
                (QuantumTemplate::PricesEqual { path }, "rule:preserve_prices") => {
                    safe_path(path)?;
                    // Rule semantics in v1 refer specifically to this catalog.
                    path == "catalog.json"
                }
                (QuantumTemplate::LiteralPresent, "goal:revise_website") => true,
                (QuantumTemplate::PublishUnavailable, "rule:deny_publish") => true,
                _ => false,
            };
            if !compatible {
                return Err("Quantum template does not cover selector semantics".into());
            }
        }
        Ok(())
    }

    pub(crate) fn select(&self, selector: &str) -> Option<&QuantumDefinition> {
        self.definitions.iter().find(|d| d.selector == selector)
    }
}

impl QuantumDefinition {
    pub(crate) fn bind(
        &self,
        result: Option<&ResultSpec>,
    ) -> Result<(BTreeSet<Dimension>, String, Check, QuantumBinding), String> {
        let (claim, check) = match &self.template {
            QuantumTemplate::AtlasReviewFresh => (
                "linked_approval_matches_recorded_head",
                Check::AtlasReviewFresh {
                    path: "host-snapshot.json".into(),
                },
            ),
            QuantumTemplate::OneProviderAllowed => (
                "declared_data_classes_allowed_for_provider",
                Check::OneProviderAllowed {
                    path: "host-snapshot.json".into(),
                },
            ),
            QuantumTemplate::OneMcpAllowed => (
                "selected_mcp_tool_and_observed_target_allowed",
                Check::OneMcpAllowed {
                    path: "host-snapshot.json".into(),
                },
            ),
            QuantumTemplate::PricesEqual { path } => (
                "catalog_price_map_unchanged",
                Check::PricesEqual { path: path.clone() },
            ),
            QuantumTemplate::PublishUnavailable => (
                "publish_capability_unavailable_in_this_runtime",
                Check::PublishUnavailable,
            ),
            QuantumTemplate::LiteralPresent => {
                let spec = result.ok_or("Literal template requires an explicit ResultSpec")?;
                safe_path(&spec.path)?;
                if spec.literal.is_empty() {
                    return Err("Empty acceptance literal".into());
                }
                (
                    "specified_literal_present_in_target_file",
                    Check::LiteralPresent {
                        path: spec.path.clone(),
                        literal: spec.literal.clone(),
                    },
                )
            }
        };
        Ok((
            self.dimensions.clone(),
            claim.into(),
            check,
            QuantumBinding {
                definition_id: self.id.clone(),
                definition_version: self.version.clone(),
                definition_hash: digest(self),
            },
        ))
    }
}
