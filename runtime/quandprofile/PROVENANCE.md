# QuandProfile in ONE

Source imported from the user's Playground `constraint-compiler/quandprofile` on
2026-11-01, then maintained here with the application. This directory and the
bundled WASM artifact ship together; there is no dependency on a local Playground
path, Rust installation or external checker in deployed ONE.

`npm run build:quandprofile` rebuilds the bounded JSON ABI with the locked Cargo
dependencies. `npm run build` verifies source and artifact hashes before bundling.
The same Rust verifiers execute in browser WASM and native compiler tests.

The browser host supplies scope, policy and observed targets. A model cannot
issue/import evidence or change a profile through this ABI. Metadata receipts
are narrow checks, not proof of semantic correctness or remote authorization.
Atlas retains its existing server-side authorization, review and write gates.
