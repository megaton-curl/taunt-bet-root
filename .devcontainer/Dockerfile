FROM --platform=linux/amd64 mcr.microsoft.com/devcontainers/base:ubuntu

# GitHub CLI (gh) - using amd64 explicitly for Rosetta compatibility
RUN type -p wget >/dev/null || (apt-get update && apt-get install -y wget) \
    && mkdir -p -m 755 /etc/apt/keyrings \
    && wget -qO /tmp/githubcli-archive-keyring.gpg https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    && cat /tmp/githubcli-archive-keyring.gpg > /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y gh \
    && rm -f /tmp/githubcli-archive-keyring.gpg

# Build dependencies (Rust/Solana compilation)
RUN apt-get update && apt-get install -y \
    git build-essential pkg-config libudev-dev libssl-dev

# Search & navigation tools — high-ROI for AI agents and human devs alike.
#   ripgrep (rg)        – fastest "find text in repo" (errors, endpoints, symbols, config)
#   universal-ctags     – jump-to-definition via tags (functions, classes, structs)
#   fd-find (fd)        – nicer `find` for file-name search (respects .gitignore)
#   fzf                 – interactive fuzzy picker (pairs with rg/fd for quick navigation)
#   jq                  – query/pretty-print JSON (logs, API responses, Anchor IDLs)
#   tree                – quick repo structure overview
#   git grep            – already included via git; solid fallback for simple text search
RUN apt-get update && apt-get install -y \
    ripgrep universal-ctags fd-find fzf jq tree \
    bubblewrap socat \
    && ln -sf /usr/bin/fdfind /usr/local/bin/fd

# Go environment (latest stable) - using amd64 explicitly for Rosetta compatibility
ARG GO_VERSION=1.22.0
RUN apt-get update && apt-get install -y wget \
    && wget -q "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" -O /tmp/go.tar.gz \
    && tar -C /usr/local -xzf /tmp/go.tar.gz \
    && rm /tmp/go.tar.gz

ENV PATH="/usr/local/go/bin:${PATH}"
ENV GOPATH="/home/vscode/go"
ENV PATH="${GOPATH}/bin:${PATH}"

# Create Go workspace for vscode user
RUN mkdir -p /home/vscode/go/bin /home/vscode/go/pkg /home/vscode/go/src \
    && chown -R vscode:vscode /home/vscode/go

# Solana + Anchor toolchain (installed as vscode user)
# One-command installer: Rust, Solana CLI, Anchor CLI, AVM — all version-matched.
# Ref: https://www.anchor-lang.com/docs/installation
USER vscode

# One-command installer provides: Rust, Solana CLI, Anchor CLI (AVM), Node.js (nvm), Yarn, Surfpool
RUN curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash

# Backend scripts and CI expect Node 22 features such as --env-file-if-exists.
ARG NODE_VERSION=22
RUN bash -ic "nvm install ${NODE_VERSION} && nvm alias default ${NODE_VERSION} && nvm use ${NODE_VERSION}"

# Default to Agave beta to keep SBF platform-tools modern enough for current crates.
# This avoids build breaks on older SBF Cargo toolchains (e.g. edition2024 parsing).
# NOTE: Commented out — agave-install command does not exist in current toolchain.
# TODO: Find correct command to switch to Agave beta, or handle this at runtime instead of build time.
# RUN bash -ic "agave-install init beta"

# PATH order matters: .avm/bin BEFORE .cargo/bin so AVM's anchor wins over any cargo-installed copy
ENV PATH="/home/vscode/.avm/bin:/home/vscode/.cargo/bin:/home/vscode/.local/share/solana/install/active_release/bin:${PATH}"

# Additional global npm packages not included in the one-command installer.
RUN bash -ic "nvm use ${NODE_VERSION} && npm install -g pnpm@10.33.0 @openai/codex @anthropic-ai/claude-code @anthropic-ai/sandbox-runtime"

# Persist PATH for interactive shells (ENV only applies to Docker build + postStartCommand).
# nvm is already sourced in .bashrc by the installer; default to the repo baseline Node.
RUN echo "nvm use --silent ${NODE_VERSION} >/dev/null 2>&1 || true" >> /home/vscode/.bashrc \
    && echo 'export PATH="$HOME/.avm/bin:$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> /home/vscode/.bashrc

# Default Solana config (keypair is restored from SOLANA_DEPLOYER_KEY env at startup)
RUN solana config set --url localhost

USER root

# PostgreSQL — installed directly to avoid GHCR feature-resolution issues.
# The devcontainer postgresql feature (ghcr.io/devcontainers/features/postgresql:1) fails
# when the devcontainer CLI can't authenticate to ghcr.io. Plain apt is more reliable.
RUN apt-get update && apt-get install -y postgresql postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Configure PostgreSQL: create vscode superuser + allow passwordless TCP from localhost
RUN pg_ctlcluster $(pg_lsclusters -h | awk '{print $1, $2}') start \
    && su - postgres -c "createuser -s vscode" \
    && pg_ctlcluster $(pg_lsclusters -h | awk '{print $1, $2}') stop \
    && PG_HBA=$(find /etc/postgresql -name pg_hba.conf | head -1) \
    && sed -i '1i host all vscode 127.0.0.1/32 trust\nhost all vscode ::1/128 trust' "$PG_HBA"

# Cursor Agent CLI (installs to ~/.local/bin/agent)
# Install as the vscode user so it lands in /home/vscode/.local/bin.
RUN mkdir -p /home/vscode/.local/bin \
    && chown -R vscode:vscode /home/vscode/.local
RUN su - vscode -c "curl -fsS https://cursor.com/install | bash"
ENV PATH="/home/vscode/.local/bin:${PATH}"

