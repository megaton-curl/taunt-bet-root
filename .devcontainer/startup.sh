#!/bin/bash
# .devcontainer/startup.sh — post-start toolchain, auth, and environment checks

echo "----------------------------------------------------------------"
echo "RNG Utopia: Post-Start Checks"
echo "----------------------------------------------------------------"

# Force-disable forwarded SSH agent for all future interactive shells.
unset SSH_AUTH_SOCK
if ! grep -q "RNG UTOPIA: disable forwarded SSH agent" "${HOME}/.bashrc" 2>/dev/null; then
  cat >> "${HOME}/.bashrc" <<'EOF'
# RNG UTOPIA: disable forwarded SSH agent
unset SSH_AUTH_SOCK
export SSH_AUTH_SOCK=""
EOF
fi

# Enforce minimum package release age for pnpm/npm installs.
if ! grep -q "^minimum-release-age=10080$" "${HOME}/.npmrc" 2>/dev/null; then
  echo "minimum-release-age=10080" >> "${HOME}/.npmrc"
fi

# ── Toolchain verification ──
echo ""
echo "Core toolchain:"
TOOLS=(node npm go gh claude codex agent)
for tool in "${TOOLS[@]}"; do
    if command -v "$tool" &> /dev/null; then
        VERSION=""
        case "$tool" in
            node) VERSION=" ($(node --version))" ;;
            npm) VERSION=" ($(npm --version))" ;;
            go) VERSION=" ($(go version | awk '{print $3}'))" ;;
        esac
        echo "  ✓ $tool$VERSION"
    else
        echo "  ✗ $tool — NOT FOUND (may need rebuild)"
    fi
done
echo ""

# ── Solana deployer keypair (deterministic across rebuilds) ──
SOLANA_KEYPAIR_PATH="${HOME}/.config/solana/id.json"
if [ -n "${SOLANA_DEPLOYER_KEY:-}" ]; then
    mkdir -p "$(dirname "$SOLANA_KEYPAIR_PATH")"
    echo "$SOLANA_DEPLOYER_KEY" > "$SOLANA_KEYPAIR_PATH"
    echo "  ✓ Solana keypair restored from SOLANA_DEPLOYER_KEY env"
elif [ ! -f "$SOLANA_KEYPAIR_PATH" ]; then
    echo "  ⚠ No SOLANA_DEPLOYER_KEY set and no keypair on disk — generating ephemeral keypair"
    solana-keygen new --no-bip39-passphrase --force 2>/dev/null
fi
DEPLOYER_ADDR="$(solana-keygen pubkey "$SOLANA_KEYPAIR_PATH" 2>/dev/null || echo 'unknown')"
echo "  Deployer: $DEPLOYER_ADDR"
echo ""

echo "Solana/Anchor toolchain:"
SOLANA_TOOLS=(rustc cargo solana anchor solana-test-validator)
for tool in "${SOLANA_TOOLS[@]}"; do
    if command -v "$tool" &> /dev/null; then
        VERSION=""
        case "$tool" in
            rustc) VERSION=" ($(rustc --version 2>/dev/null | awk '{print $2}'))" ;;
            cargo) VERSION=" ($(cargo --version 2>/dev/null | awk '{print $2}'))" ;;
            solana) VERSION=" ($(solana --version 2>/dev/null | awk '{print $2}'))" ;;
            anchor) VERSION=" ($(anchor --version 2>/dev/null | awk '{print $2}'))" ;;
        esac
        echo "  ✓ $tool$VERSION"
    else
        echo "  ✗ $tool — NOT FOUND (may need rebuild)"
    fi
done
echo ""

# Preflight warning for known-incompatible SBF platform-tools.
if command -v cargo-build-sbf &> /dev/null; then
    SBF_VERSION_OUTPUT="$(cargo-build-sbf --version 2>&1)"
    echo "  ✓ cargo-build-sbf ($SBF_VERSION_OUTPUT)"

    PLATFORM_TOOLS="$(printf '%s\n' "$SBF_VERSION_OUTPUT" | sed -n 's/.*platform-tools v\([0-9][0-9]*\)\.\([0-9][0-9]*\).*/\1 \2/p' | head -1)"
    if [ -n "$PLATFORM_TOOLS" ]; then
        PT_MAJOR="$(echo "$PLATFORM_TOOLS" | awk '{print $1}')"
        PT_MINOR="$(echo "$PLATFORM_TOOLS" | awk '{print $2}')"
        if [ "$PT_MAJOR" -lt 1 ] || { [ "$PT_MAJOR" -eq 1 ] && [ "$PT_MINOR" -lt 52 ]; }; then
            echo "  ⚠ platform-tools v${PT_MAJOR}.${PT_MINOR} detected; v1.52+ recommended for current Solana crate compatibility."
            echo "    Fix: Update Solana version manually or rebuild the container with updated toolchain."
        fi
    fi
else
    echo "  ✗ cargo-build-sbf — NOT FOUND (may need rebuild)"
fi
echo ""

echo "Database:"
# PostgreSQL is installed via apt in the Dockerfile. Start the cluster on each container boot.
if command -v psql &> /dev/null; then
    # Start PostgreSQL if not already running
    if ! pg_isready -q 2>/dev/null; then
        sudo pg_ctlcluster $(pg_lsclusters -h | awk '{print $1, $2}') start 2>/dev/null
    fi
    if pg_isready -q 2>/dev/null; then
        echo "  ✓ PostgreSQL running"
        # Create dev database if it doesn't exist (vscode superuser was created at build time)
        if psql -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw rng_utopia_dev; then
            echo "  ✓ Database rng_utopia_dev exists"
        else
            createdb rng_utopia_dev 2>/dev/null && echo "  ✓ Database rng_utopia_dev created" || echo "  ⚠ Could not create rng_utopia_dev"
        fi
    else
        echo "  ⚠ PostgreSQL installed but failed to start"
    fi
else
    echo "  ✗ PostgreSQL — NOT FOUND"
fi
echo ""

echo "Search & nav tools:"
SEARCH_TOOLS=(rg fd fzf jq tree ctags)
for tool in "${SEARCH_TOOLS[@]}"; do
    if command -v "$tool" &> /dev/null; then
        echo "  ✓ $tool"
    else
        echo "  ✗ $tool — NOT FOUND"
    fi
done
echo ""

echo "Sandbox tools:"
# Claude Code sandbox uses bwrap; in devcontainer bwrap cannot mount /proc. We set enableWeakerNestedSandbox
# in .claude/settings.local.json so the sandbox uses a weaker mode that works inside Docker.
SANDBOX_TOOLS=(bwrap socat)
for tool in "${SANDBOX_TOOLS[@]}"; do
    if command -v "$tool" &> /dev/null; then
        echo "  ✓ $tool"
    else
        echo "  ✗ $tool — NOT FOUND"
    fi
done
# Check seccomp filter from @anthropic-ai/sandbox-runtime
SANDBOX_RT_DIR="$(npm root -g 2>/dev/null)/@anthropic-ai/sandbox-runtime"
if [ -d "$SANDBOX_RT_DIR" ]; then
    echo "  ✓ @anthropic-ai/sandbox-runtime"
else
    echo "  ✗ @anthropic-ai/sandbox-runtime — NOT FOUND"
fi
echo ""

# Fix volume ownership: named volumes are often root-owned; current user must own them to read/write
CURSOR_AGENT_CONFIG_DIR="${CURSOR_CONFIG_DIR:-${HOME}/.cursor-agent-cli}"
CODEX_DIR="${HOME}/.codex"
CODEX_PERSIST_DIR="${HOME}/.codex-persist"
GIT_PERSIST_DIR="${HOME}/.git-persistence"
for dir in "${HOME}/.config/gh" "${HOME}/.claude" "${CODEX_DIR}" "${CODEX_PERSIST_DIR}" "${CURSOR_AGENT_CONFIG_DIR}" "${GIT_PERSIST_DIR}"; do
  if [ -d "$dir" ] && ! [ -O "$dir" ]; then
    sudo chown -R "$(id -u):$(id -g)" "$dir" 2>/dev/null || true
  fi
done

# Ensure the persisted git config file exists so Git doesn't complain
mkdir -p "${GIT_PERSIST_DIR}"
touch "${GIT_PERSIST_DIR}/.gitconfig"

# 1. Check GitHub CLI
# 'gh auth status' returns 0 if logged in, non-zero otherwise
if command -v gh &> /dev/null; then
    if gh auth status &> /dev/null; then
        echo "✅ GitHub: Authenticated"
        # Route GitHub remotes through HTTPS and let gh handle credentials.
        # This keeps auth consistent with `gh auth login` and avoids SSH key dependency.
        gh auth setup-git >/dev/null 2>&1 || true
        # Rebuild both rewrite rules idempotently; --add is required for multiple values.
        git config --global --unset-all url."https://github.com/".insteadOf >/dev/null 2>&1 || true
        git config --global --add url."https://github.com/".insteadOf "git@github.com:"
        git config --global --add url."https://github.com/".insteadOf "ssh://git@github.com/"
    else
        echo "❌ GitHub: NOT AUTHENTICATED"
        echo "   👉 Run: 'gh auth login' to enable repository access."
    fi
else
    echo "⚠️  GitHub: 'gh' CLI not found. (Will be installed if using the standard devcontainer image)"
fi

# 2. Check Claude Code
# Persistence Hack: ~/.claude.json (MCP Config) needs to be persisted but is a file.
# We store it inside the persisted ~/.claude directory and symlink it out.
# Use $HOME so this works for the actual container user (vscode), avoiding permission errors.
if command -v claude &> /dev/null; then
    echo "✅ Claude: CLI installed"
else
    echo "⚠️  Claude: 'claude' CLI not found."
fi

CLAUDE_DIR="${HOME}/.claude"
PERSISTED_MCP_CONFIG="${CLAUDE_DIR}/claude.json"
TARGET_MCP_CONFIG="${HOME}/.claude.json"

# Ensure persistence directory exists (it should from volume mount)
mkdir -p "$CLAUDE_DIR"

if [ ! -L "$TARGET_MCP_CONFIG" ]; then
    # If standard file exists (atomic write?), back it up to persistence
    if [ -f "$TARGET_MCP_CONFIG" ]; then
        echo "📦 Migrating existing ~/.claude.json to persistence..."
        mv "$TARGET_MCP_CONFIG" "$PERSISTED_MCP_CONFIG"
    fi

    # Ensure target exists so symlink isn't broken
    if [ ! -f "$PERSISTED_MCP_CONFIG" ]; then
        echo "{}" > "$PERSISTED_MCP_CONFIG"
    fi

    echo "🔗 Linking ~/.claude.json to persisted volume..."
    ln -sf "$PERSISTED_MCP_CONFIG" "$TARGET_MCP_CONFIG"
fi

# Claude Code's auth state is not reliably detectable without starting an interactive session.
# We keep this as a non-failing hint so the startup check doesn't give false negatives.
echo "ℹ️  Claude: Login status not checked (run 'claude' then '/status' to verify)."

# 3. Check Codex CLI
if command -v codex &> /dev/null; then
    # Minimal persistence strategy:
    # - Persist only auth.json + config.toml in ${HOME}/.codex-persist (mounted volume)
    # - Keep history/sessions/logs ephemeral in ${HOME}/.codex
    # Docs: Codex caches creds at ~/.codex/auth.json OR in keyring; we force file storage in config.toml
    # to make persistence deterministic in containers. https://developers.openai.com/codex/auth
    mkdir -p "$CODEX_DIR" "$CODEX_PERSIST_DIR"

    CODEX_AUTH_FILE="${CODEX_DIR}/auth.json"
    CODEX_CONFIG_FILE="${CODEX_DIR}/config.toml"
    PERSIST_AUTH_FILE="${CODEX_PERSIST_DIR}/auth.json"
    PERSIST_CONFIG_FILE="${CODEX_PERSIST_DIR}/config.toml"

    if [ ! -L "$CODEX_CONFIG_FILE" ]; then
        if [ -f "$CODEX_CONFIG_FILE" ]; then
            echo "📦 Migrating existing ~/.codex/config.toml to persistence..."
            mv "$CODEX_CONFIG_FILE" "$PERSIST_CONFIG_FILE" 2>/dev/null || true
        fi
        if [ ! -f "$PERSIST_CONFIG_FILE" ]; then
            cat > "$PERSIST_CONFIG_FILE" <<'EOF'
# Minimal Codex config for devcontainers:
# - Persist auth on disk (not OS keyring) so it survives rebuilds.
# - Avoid persisting history/transcripts.
cli_auth_credentials_store = "file"
history.persistence = "none"
EOF
        fi
        ln -sf "$PERSIST_CONFIG_FILE" "$CODEX_CONFIG_FILE"
    fi

    if [ ! -L "$CODEX_AUTH_FILE" ]; then
        if [ -f "$CODEX_AUTH_FILE" ]; then
            echo "📦 Migrating existing ~/.codex/auth.json to persistence..."
            mv "$CODEX_AUTH_FILE" "$PERSIST_AUTH_FILE" 2>/dev/null || true
        fi
        # Don't create an empty auth.json; Codex will write it on login.
        ln -sf "$PERSIST_AUTH_FILE" "$CODEX_AUTH_FILE"
    fi

    if [ -s "$PERSIST_AUTH_FILE" ]; then
        echo "✅ Codex: Authenticated (persisted auth.json present)"
    else
        echo "❌ Codex: NOT AUTHENTICATED"
        echo "   👉 Run: 'codex login' (or 'codex') to authenticate."
    fi
else
    echo "⚠️  Codex: 'codex' CLI not found."
fi

# 4. Check Cursor Agent CLI
if command -v agent &> /dev/null; then
    # Persisting Cursor Agent CLI auth:
    # - Docs say global config is stored at ~/.cursor/cli-config.json by default, or under CURSOR_CONFIG_DIR when set.
    #   https://cursor.com/docs/cli/reference/configuration
    # - In practice, some versions still read/write the default path, so we also symlink it to the persisted location.
    mkdir -p "$CURSOR_AGENT_CONFIG_DIR" "${HOME}/.cursor"
    LEGACY_CURSOR_CONFIG="${HOME}/.cursor/cli-config.json"
    NEW_CURSOR_CONFIG="${CURSOR_AGENT_CONFIG_DIR}/cli-config.json"

    # Migrate once if we have legacy config but no persisted copy yet
    if [ -f "$LEGACY_CURSOR_CONFIG" ] && [ ! -f "$NEW_CURSOR_CONFIG" ]; then
        echo "📦 Migrating Cursor Agent CLI config to ${CURSOR_AGENT_CONFIG_DIR}..."
        cp "$LEGACY_CURSOR_CONFIG" "$NEW_CURSOR_CONFIG" 2>/dev/null || true
    fi

    # Ensure default location points at persisted config (covers CLIs that ignore CURSOR_CONFIG_DIR)
    if [ ! -L "$LEGACY_CURSOR_CONFIG" ]; then
        ln -sf "$NEW_CURSOR_CONFIG" "$LEGACY_CURSOR_CONFIG"
    fi

    # Minimal, file-based auth check: require auth fields in cli-config.json.
    # This avoids false positives where the file exists but the user is logged out.
    if [ -s "$NEW_CURSOR_CONFIG" ] && grep -q '"authInfo"' "$NEW_CURSOR_CONFIG" 2>/dev/null; then
        echo "✅ Cursor Agent: Authenticated (credentials present in cli-config.json)"
    else
        echo "❌ Cursor Agent: NOT AUTHENTICATED"
        echo "   👉 Run: 'agent login' to authenticate."
    fi
else
    echo "⚠️  Cursor Agent: 'agent' CLI not found."
fi

# ── Git hooks ──
echo ""
echo "Git hooks:"
BACKEND_DIR="/workspaces/rng-utopia/backend"
if [ -d "$BACKEND_DIR/.githooks" ]; then
    git -C "$BACKEND_DIR" config core.hooksPath .githooks 2>/dev/null && \
        echo "  ✓ Backend pre-commit typecheck hook active" || true
else
    echo "  ⚠ .githooks not found in backend submodule"
fi

echo "----------------------------------------------------------------"
