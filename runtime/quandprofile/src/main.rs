use quandprofile::{Contract, Files, QuandProfile, QuantumCatalog, ResultSpec, Runtime};
use serde::Deserialize;
use serde_json::json;
use std::io::{self, Read};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {
    contract: Contract,
    files: Files,
    result_spec: Option<ResultSpec>,
    #[serde(default)]
    actions: Vec<serde_json::Value>,
}

fn run() -> Result<(), String> {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let gate_mode = args.iter().any(|a| a == "--gate");
    args.retain(|a| a != "--gate");
    let catalog = match args.as_slice() {
        [] => QuantumCatalog::builtin(),
        [flag, path] if flag == "--catalog" => {
            QuantumCatalog::from_json(&std::fs::read_to_string(path).map_err(|e| e.to_string())?)?
        }
        _ => return Err("Usage: quandprofile [--catalog PATH] < request.json".into()),
    };
    let mut text = String::new();
    io::stdin()
        .read_to_string(&mut text)
        .map_err(|e| e.to_string())?;
    if gate_mode {
        let request = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        let response = quandprofile::integration::check(request, &catalog)?;
        println!(
            "{}",
            serde_json::to_string(&response).map_err(|e| e.to_string())?
        );
        return Ok(());
    }
    let input: Input = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let profile = QuandProfile::compile_with_catalog(&input.contract, input.result_spec, &catalog)?;
    let mut runtime = Runtime::new(profile, input.files)?;
    let initial = runtime.evaluate();
    let first_verification = runtime.verify();
    let initial_work_context = runtime.work_context();
    let mut steps = Vec::new();
    for action in input.actions {
        let result = runtime.execute_json(&action.to_string());
        let before_recheck = runtime.evaluate();
        let after_recheck = runtime.verify();
        steps.push(json!({"action": action, "accepted": result.is_ok(),
            "detail": result.unwrap_or_else(|e| e),
            "before_recheck": before_recheck, "after_recheck": after_recheck}));
    }
    let report = json!({"profile": runtime.profile(), "initial": initial,
        "first_verification": first_verification, "initial_work_context": initial_work_context,
        "final_work_context": runtime.work_context(), "steps": steps,
        "final_evaluation": runtime.evaluate(), "quanta": runtime.ledger(),
        "events": runtime.events(), "files": runtime.files(), "finished": runtime.finished(),
        "scope": "Local registered verifiers, in-memory project; no model or external publication"});
    println!(
        "{}",
        serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?
    );
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
