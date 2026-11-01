use quandprofile::{Contract, QuandProfile, QuantumCatalog, ResultSpec, Runtime, Status};
use serde_json::{json, Value};

fn catalog_json() -> Value {
    serde_json::to_value(QuantumCatalog::builtin()).unwrap()
}

fn contract() -> Contract {
    serde_json::from_value(json!({"version":1,"goals":["revise_website"],"rules":[
        {"id":"r1","kind":"preserve_prices","source_id":"u1","source_text":"Keep prices"},
        {"id":"r2","kind":"deny_publish","source_id":"u1","source_text":"Never publish"}
    ]}))
    .unwrap()
}

fn compile(catalog: &QuantumCatalog) -> QuandProfile {
    QuandProfile::compile_with_catalog(
        &contract(),
        Some(ResultSpec {
            path: "index.html".into(),
            literal: "Hello".into(),
        }),
        catalog,
    )
    .unwrap()
}

#[test]
fn selects_and_pins_definitions_independent_of_runtime_results() {
    let p = compile(&QuantumCatalog::builtin());
    let b = p.obligations()[0].quantum_binding.as_ref().unwrap();
    assert_eq!(b.definition_id, "data.price-map-equality");
    assert_eq!(b.definition_version, "1.0.0");
    assert_eq!(b.definition_hash.len(), 64);
    let r = Runtime::new(p, Default::default()).unwrap();
    assert!(r.ledger().is_empty());
    assert_eq!(r.evaluate().status, Status::Open);
}

#[test]
fn missing_definition_keeps_obligation_open() {
    let catalog = QuantumCatalog::from_json(
        r#"{"dimensions":[{"id":"interpretation","title":"Interpretation"}],"definitions":[]}"#,
    )
    .unwrap();
    let p = compile(&catalog);
    assert!(p.obligations().iter().all(|o| o.quantum_binding.is_none()));
    let mut r = Runtime::new(p, Default::default()).unwrap();
    assert_eq!(r.verify().status, Status::Open);
    assert!(r
        .execute_json(r#"{"action":"finish","contract_version":1}"#)
        .is_err());
}

#[test]
fn ambiguous_selection_rejected_even_across_versions() {
    let mut data = catalog_json();
    let mut duplicate = data["definitions"][0].clone();
    duplicate["version"] = json!("2.0.0");
    data["definitions"].as_array_mut().unwrap().push(duplicate);
    assert!(QuantumCatalog::from_json(&data.to_string()).is_err());
}

#[test]
fn incompatible_verifier_cannot_substitute_for_price_rule() {
    let mut data = catalog_json();
    data["definitions"][0]["template"] = json!({"kind":"publish_unavailable"});
    assert!(QuantumCatalog::from_json(&data.to_string()).is_err());
}

#[test]
fn price_template_cannot_change_rule_scope() {
    let mut data = catalog_json();
    data["definitions"][0]["template"]["path"] = json!("unrelated.json");
    assert!(QuantumCatalog::from_json(&data.to_string()).is_err());
}

#[test]
fn unknown_executable_verifier_is_rejected() {
    let mut data = catalog_json();
    data["definitions"][0]["template"] = json!({"kind":"shell","command":"anything"});
    assert!(QuantumCatalog::from_json(&data.to_string()).is_err());
}

#[test]
fn updated_definition_changes_binding_and_profile_fingerprint() {
    let original = compile(&QuantumCatalog::builtin());
    let mut data = catalog_json();
    data["definitions"][0]["version"] = json!("1.1.0");
    let updated = compile(&QuantumCatalog::from_json(&data.to_string()).unwrap());
    assert_ne!(original.fingerprint(), updated.fingerprint());
    assert_ne!(
        original.obligations()[0]
            .quantum_binding
            .as_ref()
            .unwrap()
            .definition_hash,
        updated.obligations()[0]
            .quantum_binding
            .as_ref()
            .unwrap()
            .definition_hash
    );
}

#[test]
fn unselected_definition_does_not_affect_profile() {
    let mut c = contract();
    c.rules.retain(|r| r.kind == "preserve_prices");
    let a = QuandProfile::compile_with_catalog(&c, None, &QuantumCatalog::builtin()).unwrap();
    let mut data = catalog_json();
    data["definitions"][1]["version"] = json!("9.0.0");
    let b = QuandProfile::compile_with_catalog(
        &c,
        None,
        &QuantumCatalog::from_json(&data.to_string()).unwrap(),
    )
    .unwrap();
    assert_eq!(a.fingerprint(), b.fingerprint());
}

#[test]
fn validation_cannot_be_bypassed_by_direct_deserialization() {
    let mut data = catalog_json();
    data["definitions"][0]["selector"] = json!("rule:deny_publish");
    let bypass: QuantumCatalog = serde_json::from_value(data).unwrap();
    assert!(QuandProfile::compile_with_catalog(&contract(), None, &bypass).is_err());
}

#[test]
fn catalog_order_does_not_change_selection() {
    let mut data = catalog_json();
    data["definitions"].as_array_mut().unwrap().reverse();
    assert_eq!(
        compile(&QuantumCatalog::builtin()).fingerprint(),
        compile(&QuantumCatalog::from_json(&data.to_string()).unwrap()).fingerprint()
    );
}

#[test]
fn quantum_can_be_active_in_multiple_dimensions_without_duplicate_proofs() {
    let p = compile(&QuantumCatalog::builtin());
    assert_eq!(p.obligations()[0].dimensions.len(), 2);
    let files = [
        ("catalog.json".into(), "[]".into()),
        ("index.html".into(), "Hello".into()),
    ]
    .into();
    let mut r = Runtime::new(p, files).unwrap();
    let evaluation = r.verify();
    assert_eq!(evaluation.status, Status::Verified);
    assert_eq!(r.ledger().len(), 3);
    assert_eq!(r.ledger()[0].dimensions.len(), 2);
    let outcome = evaluation
        .dimensions
        .iter()
        .find(|d| d.dimension_id == "outcome")
        .unwrap();
    assert_eq!(outcome.obligation_ids.len(), 2);
}

#[test]
fn custom_dimensions_are_independent_catalog_definitions() {
    let mut data = catalog_json();
    data["dimensions"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"governance","title":"Governance"}));
    data["definitions"][0]["dimensions"] = json!(["data", "governance"]);
    let p = compile(&QuantumCatalog::from_json(&data.to_string()).unwrap());
    assert!(p.obligations()[0].dimensions.contains("governance"));
    assert!(p.dimension_definitions.iter().any(|d| d.id == "governance"));
}

#[test]
fn empty_unknown_and_missing_core_dimensions_are_rejected() {
    for dimensions in [json!([]), json!(["unknown"]), json!(["outcome"])] {
        let mut data = catalog_json();
        data["definitions"][0]["dimensions"] = dimensions;
        assert!(QuantumCatalog::from_json(&data.to_string()).is_err());
    }
}

#[test]
fn changed_dimension_membership_changes_profile_hash() {
    let original = compile(&QuantumCatalog::builtin());
    let mut data = catalog_json();
    data["definitions"][0]["dimensions"] = json!(["data"]);
    let updated = compile(&QuantumCatalog::from_json(&data.to_string()).unwrap());
    assert_ne!(original.fingerprint(), updated.fingerprint());
}

#[test]
fn dimension_order_has_set_semantics() {
    let original = compile(&QuantumCatalog::builtin());
    let mut data = catalog_json();
    data["definitions"][0]["dimensions"] = json!(["outcome", "data"]);
    data["dimensions"].as_array_mut().unwrap().reverse();
    let updated = compile(&QuantumCatalog::from_json(&data.to_string()).unwrap());
    assert_eq!(original.fingerprint(), updated.fingerprint());
}

#[test]
fn duplicate_dimension_definitions_rejected() {
    let mut data = catalog_json();
    let duplicate = data["dimensions"][0].clone();
    data["dimensions"].as_array_mut().unwrap().push(duplicate);
    assert!(QuantumCatalog::from_json(&data.to_string()).is_err());
}
