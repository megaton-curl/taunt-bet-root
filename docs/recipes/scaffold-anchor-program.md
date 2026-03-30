# Recipe: Scaffold a New Anchor Program

Linear steps for adding a new deployable Anchor program to the workspace.

## Prerequisites

- Anchor CLI 0.32.1+, Solana CLI 3.0.15+, Rust 1.93.1+
- Existing workspace at `sources/rng-utopia/solana/`

## Steps

### 1. Create the program crate

```bash
cd sources/rng-utopia/solana
mkdir -p programs/<name>/src/instructions
```

### 2. Write Cargo.toml

```toml
[package]
name = "<name>"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]
name = "<name>"

[dependencies]
anchor-lang = { workspace = true }
rng-shared = { workspace = true }

[features]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
cpi = ["no-entrypoint"]
default = []
idl-build = ["anchor-lang/idl-build"]
```

### 3. Write minimal lib.rs

```rust
use anchor_lang::prelude::*;
declare_id!("PLACEHOLDER");

#[program]
pub mod <name> {
    use super::*;
    // instructions here
}
```

### 4. Add to workspace

In `solana/Cargo.toml`, add `"programs/<name>"` to the `members` array.

In `solana/Anchor.toml`, add under `[programs.localnet]`:
```toml
<name> = "PLACEHOLDER"
```

### 5. Generate keypair and get program ID

```bash
cd sources/rng-utopia/solana
mkdir -p target/deploy
solana-keygen new -o target/deploy/<name>-keypair.json --no-bip39-passphrase --force
# Note the pubkey from output
```

### 6. Replace PLACEHOLDERs

Update `declare_id!()` in `lib.rs` and `Anchor.toml` with the real pubkey.

### 7. Build

```bash
anchor build
```

Verify outputs exist:
- `target/deploy/<name>.so`
- `target/idl/<name>.json`
- `target/types/<name>.ts`

### 8. Test

Write tests in `solana/tests/<name>.ts` using `anchor-bankrun`:

```typescript
import { startAnchor, BankrunProvider } from "anchor-bankrun";
import { Program } from "@coral-xyz/anchor";
// ...

const context = await startAnchor("./", [], []);
const provider = new BankrunProvider(context);
const program = new Program(IDL, provider);
```

Run:
```bash
anchor test --skip-local-validator --skip-deploy
```

## Key gotchas

- Programs MUST be in `programs/<name>/` subdirectory (Anchor convention)
- Shared lib crate (`shared/`) goes at workspace root, NOT inside `programs/`
- Anchor adds 6000 to `#[error_code]` enum values (use `= 100` to get error code 6100)
- `anchor build` without `-p` silently does nothing if programs aren't discoverable
- `--skip-deploy` flag needed alongside `--skip-local-validator` for bankrun tests
- Node 24+ runs .ts as ESM natively; use `import.meta.url` instead of `__dirname`
- `"type": "module"` in package.json eliminates ESM warnings
