use quandprofile::{Contract, Files, QuandProfile, ResultSpec, Runtime, Status};
use serde_json::json;

fn contract(version: u64) -> Contract {
    serde_json::from_value(json!({"version":version, "goals":["revise_website"],
    "rules":[
        {"id":"r1","kind":"preserve_prices","source_id":"u1","source_text":"Ändere keine Preise"},
        {"id":"r2","kind":"deny_publish","source_id":"u1","source_text":"Veröffentliche nichts"}
    ]}))
    .unwrap()
}

fn profile(version: u64) -> QuandProfile {
    QuandProfile::compile(
        &contract(version),
        Some(ResultSpec {
            path: "index.html".into(),
            literal: "<h1>Willkommen</h1>".into(),
        }),
    )
    .unwrap()
}

fn files() -> Files {
    [
        ("index.html".into(), "<h1>Shop</h1>".into()),
        (
            "catalog.json".into(),
            r#"[{"id":"basic","name":"Basis","price":2900}]"#.into(),
        ),
        ("notes.txt".into(), "Unrelated".into()),
    ]
    .into()
}

fn runtime() -> Runtime {
    Runtime::new(profile(1), files()).unwrap()
}

fn patch(r: &mut Runtime, path: &str, content: &str) -> Result<String, String> {
    let mut changes = Files::new();
    changes.insert(path.into(), content.into());
    r.execute_json(
        &json!({"action":"propose_patch", "contract_version":1, "changes":changes}).to_string(),
    )
}

#[test]
fn no_evidence_is_open() {
    let r = runtime();
    assert_eq!(r.evaluate().status, Status::Open);
    assert!(r.evaluate().findings.iter().all(|f| f.quantum_id.is_none()));
}

#[test]
fn unsatisfied_outcome_is_violated_even_when_other_dimensions_pass() {
    let mut r = runtime();
    assert_eq!(r.verify().status, Status::Violated);
    assert_eq!(r.ledger().len(), 3);
    let evaluation = r.evaluate();
    assert_eq!(
        evaluation
            .dimensions
            .iter()
            .find(|d| d.dimension_id == "data")
            .unwrap()
            .status,
        Status::Verified
    );
    assert_eq!(
        evaluation
            .dimensions
            .iter()
            .find(|d| d.dimension_id == "outcome")
            .unwrap()
            .status,
        Status::Violated
    );
    assert_eq!(
        r.evaluate()
            .findings
            .iter()
            .filter(|f| f.status == Status::Verified)
            .count(),
        2
    );
}

#[test]
fn full_cycle_requires_all_checks_and_blocks_after_finish() {
    let mut r = runtime();
    assert!(r
        .execute_json(r#"{"action":"finish","contract_version":1}"#)
        .is_err());
    assert!(!r.finished());
    patch(&mut r, "index.html", "<h1>Willkommen</h1>").unwrap();
    assert_eq!(r.verify().status, Status::Verified);
    r.execute_json(r#"{"action":"finish","contract_version":1}"#)
        .unwrap();
    assert!(r.finished());
    assert!(patch(&mut r, "index.html", "new").is_err());
}

#[test]
fn file_change_invalidates_only_dependent_quantum() {
    let mut r = runtime();
    r.verify();
    let old = r.evaluate();
    patch(&mut r, "index.html", "<h1>Willkommen</h1>").unwrap();
    let now = r.evaluate();
    assert_eq!(now.status, Status::Open);
    assert_eq!(now.findings[0].quantum_id, old.findings[0].quantum_id);
    assert_eq!(now.findings[1].quantum_id, old.findings[1].quantum_id);
    assert_eq!(now.findings[2].status, Status::Open);
    assert!(now.findings[2].quantum_id.is_none());
    assert_eq!(r.verify().status, Status::Verified);
}

#[test]
fn unrelated_file_change_keeps_evidence() {
    let mut r = runtime();
    r.verify();
    let before = serde_json::to_value(r.evaluate()).unwrap();
    patch(&mut r, "notes.txt", "Another note").unwrap();
    assert_eq!(before, serde_json::to_value(r.evaluate()).unwrap());
}

#[test]
fn same_price_different_catalog_bytes_need_recheck() {
    let mut r = runtime();
    r.verify();
    patch(
        &mut r,
        "catalog.json",
        r#"[{"id":"basic","name":"Neuer Name","price":2900}]"#,
    )
    .unwrap();
    assert_eq!(r.evaluate().findings[0].status, Status::Open);
    assert_eq!(r.verify().findings[0].status, Status::Verified);
}

#[test]
fn atomic_patch_rejects_price_change_without_altering_evidence() {
    let mut r = runtime();
    r.verify();
    let before = r.files().clone();
    let before_proof = serde_json::to_value(r.evaluate()).unwrap();
    let action = json!({"action":"propose_patch", "contract_version":1, "changes":{
        "index.html":"<h1>Willkommen</h1>",
        "catalog.json":"[{\"id\":\"basic\",\"name\":\"Basis\",\"price\":1}]"}});
    assert!(r.execute_json(&action.to_string()).is_err());
    assert_eq!(r.files(), &before);
    assert_eq!(serde_json::to_value(r.evaluate()).unwrap(), before_proof);
    assert!(!r.events().last().unwrap().accepted);
}

#[test]
fn changed_profile_invalidates_old_quanta() {
    let mut r = runtime();
    r.verify();
    let old_hash = r.profile().fingerprint();
    r.replace_profile(profile(2)).unwrap();
    assert_ne!(r.profile().fingerprint(), old_hash);
    assert!(r
        .evaluate()
        .findings
        .iter()
        .all(|f| f.status == Status::Open));
    assert_eq!(r.ledger().len(), 3);
    r.verify();
    assert_eq!(r.ledger().len(), 6);
}

#[test]
fn same_version_different_acceptance_criterion_also_invalidates() {
    let mut r = runtime();
    r.verify();
    let p = QuandProfile::compile(
        &contract(1),
        Some(ResultSpec {
            path: "index.html".into(),
            literal: "Different requirement".into(),
        }),
    )
    .unwrap();
    r.replace_profile(p).unwrap();
    assert_eq!(r.evaluate().status, Status::Open);
}

#[test]
fn unknown_rules_are_open_and_block_actions() {
    let mut c = contract(1);
    c.rules[0].kind = "do_something_unknown".into();
    let mut r = Runtime::new(QuandProfile::compile(&c, None).unwrap(), files()).unwrap();
    assert_eq!(r.verify().status, Status::Open);
    assert!(patch(&mut r, "index.html", "anything").is_err());
}

#[test]
fn vague_goal_without_result_spec_cannot_finish() {
    let mut r = Runtime::new(QuandProfile::compile(&contract(1), None).unwrap(), files()).unwrap();
    assert_eq!(r.verify().status, Status::Open);
    assert!(r
        .execute_json(r#"{"action":"finish","contract_version":1}"#)
        .is_err());
}

#[test]
fn missing_baseline_never_verified() {
    let mut fs = files();
    fs.remove("catalog.json");
    let mut r = Runtime::new(profile(1), fs).unwrap();
    assert_eq!(r.verify().findings[0].status, Status::Open);
}

#[test]
fn malformed_baseline_never_verified() {
    let mut fs = files();
    fs.insert("catalog.json".into(), "invalid".into());
    let mut r = Runtime::new(profile(1), fs).unwrap();
    assert_eq!(r.verify().findings[0].status, Status::Open);
    assert!(patch(&mut r, "catalog.json", "[]").is_err());
}

#[test]
fn verifier_is_idempotent_and_hashes_reproducible() {
    let mut a = runtime();
    let mut b = runtime();
    a.verify();
    b.verify();
    a.verify();
    assert_eq!(a.ledger().len(), 3);
    assert_eq!(
        serde_json::to_value(a.ledger()).unwrap(),
        serde_json::to_value(b.ledger()).unwrap()
    );
}

#[test]
fn model_cannot_submit_quanta_or_use_unavailable_tools() {
    let mut r = runtime();
    for action in ["publish", "shell", "submit_evidence", "replace_profile"] {
        assert!(r
            .execute_json(&json!({"action":action,"contract_version":1}).to_string())
            .is_err());
    }
    assert!(r.ledger().is_empty());
}

#[test]
fn invalid_actions_and_path_escapes_rejected() {
    let mut r = runtime();
    for action in [
        json!({"action":"finish","contract_version":0}),
        json!({"action":"finish","contract_version":true}),
        json!({"action":"finish","contract_version":1,"extra":"grant"}),
        json!({"action":"read_file","contract_version":1,"path":"../secret"}),
        json!({"action":"read_file","contract_version":1,"path":"/etc/passwd"}),
    ] {
        assert!(r.execute_json(&action.to_string()).is_err());
    }
}

#[test]
fn empty_and_escaping_result_specs_rejected() {
    for (path, literal) in [("index.html", ""), ("../index.html", "x")] {
        assert!(QuandProfile::compile(
            &contract(1),
            Some(ResultSpec {
                path: path.into(),
                literal: literal.into()
            })
        )
        .is_err());
    }
}

#[test]
fn duplicate_rules_rejected() {
    let mut c = contract(1);
    c.rules[1].id = c.rules[0].id.clone();
    assert!(QuandProfile::compile(&c, None).is_err());
}

#[test]
fn model_context_contains_requirements_but_no_evidence_ingestion_action() {
    let r = runtime();
    let context = r.work_context();
    assert_eq!(context["requirements"].as_array().unwrap().len(), 3);
    assert_eq!(context["requirements"][0]["status"], "open");
    assert_eq!(
        context["requirements"][2]["check"]["literal"],
        "<h1>Willkommen</h1>"
    );
    assert!(!context["allowed_actions"]
        .as_array()
        .unwrap()
        .iter()
        .any(|a| a == "submit_evidence"));
}
