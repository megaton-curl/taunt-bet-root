# RNG Utopia DevContainer

This devcontainer provides a reproducible development environment with persistent CLI authentication across container rebuilds.

## Features

### Installed Tools
- **Node.js 20 LTS** - JavaScript/TypeScript runtime with npm, yarn, and pnpm
- **Go 1.22** - Go programming language with workspace setup
- **GitHub CLI** (`gh`) - Repository management
- **Solana/Agave (beta channel by default)** - includes `solana`, `cargo-build-sbf`, validator tooling
- **Claude Code CLI** (`claude`) - AI-assisted development
- **OpenAI Codex CLI** (`codex`) - AI-assisted development
- **Cursor Agent CLI** (`agent`) - AI-assisted development
- **Common utilities** - ripgrep, jq, git, build-essential

### Credentials Persistence

All CLI authentications are persisted using Docker named volumes:
- `rng_utopia_gh_config` - GitHub CLI credentials
- `rng_utopia_claude_config` - Claude Code credentials and MCP config
- `rng_utopia_codex_config` - Codex CLI credentials
- `rng_utopia_cursor_agent_cli_config` - Cursor Agent CLI credentials

This means you only need to authenticate once, and your credentials will survive container rebuilds.

## Usage

1. Open this folder in VS Code with the Dev Containers extension installed
2. When prompted, click "Reopen in Container"
3. Wait for the container to build (first time only)
4. Run the post-start checks to verify your authentication status:
   - The `.devcontainer/startup.sh` script runs automatically on container start
   - Follow the prompts to authenticate any tools that aren't yet logged in

## Solana Toolchain Baseline

This devcontainer is configured to default to an Agave toolchain with modern SBF platform-tools.

Recommended minimum for builds in this repo:
- `cargo-build-sbf` reporting `platform-tools v1.52+`

Quick check:

```bash
anchor --version
solana --version
cargo-build-sbf --version
```

## First-Time Authentication

After the container starts, authenticate each CLI tool you plan to use:

```bash
# GitHub CLI
gh auth login

# Claude Code CLI
claude
# Then run: /status

# Codex CLI
codex login

# Cursor Agent CLI
agent login
```

These credentials will be preserved across container rebuilds.

## Rebuilding the Container

If you need to rebuild the container (e.g., to update base images or tools):

1. Open the Command Palette (Cmd/Ctrl + Shift + P)
2. Run "Dev Containers: Rebuild Container"
3. Your authentication credentials will be preserved via the named volumes
