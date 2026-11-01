use quandprofile::{
    adapters::{atlas_review, one_provider, AtlasReviewSnapshot, OneProviderSnapshot, Review},
    integration::{check, Request},
    QuantumCatalog, Status,
};
use serde_json::json;

#[test]
fn atlas_stale_missing_and_current_have_distinct_results() {
    let mut s = AtlasReviewSnapshot {
        head_sha: "ABC".into(),
        linked_reviews: vec![],
    };
    assert_eq!(atlas_review(&s).1, "review-missing");
    s.linked_reviews.push(Review {
        verdict: "approve".into(),
        commit_sha: "def".into(),
    });
    assert_eq!(atlas_review(&s).1, "review-stale");
    s.head_sha = "".into();
    assert_eq!(atlas_review(&s).1, "review-head-missing");
    s.head_sha = "DEF".into();
    assert_eq!(atlas_review(&s).0, Status::Verified);
}

#[test]
fn unknown_class_and_provider_never_allow() {
    let mut s:OneProviderSnapshot=serde_json::from_value(json!({"provider":"unknown","classes":[],
        "provider_rule":null,"device_allow":[],"device_narrow":[],"member_classes_owned_by_member":true})).unwrap();
    assert_eq!(one_provider(&s).0, Status::Open);
    s.provider = "local".into();
    s.classes.insert("unknown".into());
    assert_eq!(one_provider(&s).0, Status::Open);
}

fn request(head: &str, revision: &str) -> Request {
    serde_json::from_value(json!({"gate":"atlas_review","scope":{
        "workspace":"tenant-a/project-a","target":"item-1","actor":"user-a",
        "state_revision":revision,"operation_digest":"sha256:example"},"snapshot":{
        "head_sha":head,"linked_reviews":[{"verdict":"approve","commit_sha":"abc"}]}}))
    .unwrap()
}

#[test]
fn fresh_snapshot_rechecked_and_bound_to_scope() {
    let catalog = QuantumCatalog::builtin();
    let a = check(request("abc", "1"), &catalog).unwrap();
    let b = check(request("def", "2"), &catalog).unwrap();
    assert_eq!(a.decision, "allow");
    assert_eq!(b.decision, "block");
    assert_ne!(a.request_digest, b.request_digest);
    assert_ne!(a.profile.fingerprint(), b.profile.fingerprint());
    assert_eq!(a.quanta.len(), 1);
    assert!(a.quanta[0]
        .dependencies
        .contains_key("host_snapshot:host-snapshot.json"));
}

#[test]
fn empty_identity_or_revision_rejected() {
    let mut value = serde_json::to_value(request("abc", "1")).unwrap();
    value["scope"]["actor"] = json!("");
    assert!(check(
        serde_json::from_value(value).unwrap(),
        &QuantumCatalog::builtin()
    )
    .is_err());
}

#[test]
fn no_website_obligation_is_invented_for_application_gate() {
    let result = check(request("abc", "1"), &QuantumCatalog::builtin()).unwrap();
    assert_eq!(result.profile.obligations().len(), 1);
    assert_eq!(result.evaluation.status, Status::Verified);
}
