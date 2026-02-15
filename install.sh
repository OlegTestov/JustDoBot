#!/usr/bin/env bash
set -euo pipefail

# ─── JustDoBot Installer ────────────────────────────────────────
# Usage: curl -fsSL https://justdobot.com/install.sh | bash
# Or:    bash install.sh (from cloned repo)

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m' # No Color

step=0
total=8

log_step() {
  step=$((step + 1))
  echo -e "\n${BOLD}[$step/$total] $1${NC}"
}

log_ok() {
  echo -e "  ${GREEN}✓${NC} $1"
}

log_warn() {
  echo -e "  ${YELLOW}⚠${NC} $1"
}

log_fail() {
  echo -e "  ${RED}✗${NC} $1"
}

echo -e "${BOLD}"
echo "  ┌────────────────────────────────────┐"
echo "  │     JustDoBot Installer            │"
echo "  │     Personal AI Workhorse          │"
echo "  └────────────────────────────────────┘"
echo -e "${NC}"

# ─── Step 1: Check system ────────────────────────────────────────

log_step "Checking system..."

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin) log_ok "macOS ($ARCH)" ;;
  Linux)  log_ok "Linux ($ARCH)" ;;
  *)
    log_fail "Unsupported OS: $OS"
    echo "  JustDoBot supports macOS and Linux."
    exit 1
    ;;
esac

# ─── Helper: ensure a line exists in shell profile ───────────────

get_shell_profile() {
  if [ -f "$HOME/.zshrc" ]; then echo "$HOME/.zshrc"
  elif [ -f "$HOME/.bashrc" ]; then echo "$HOME/.bashrc"
  elif [ -f "$HOME/.bash_profile" ]; then echo "$HOME/.bash_profile"
  else
    # No profile exists — create one based on current shell
    if [ "$(basename "${SHELL:-/bin/zsh}")" = "zsh" ]; then
      touch "$HOME/.zshrc"
      echo "$HOME/.zshrc"
    else
      touch "$HOME/.bashrc"
      echo "$HOME/.bashrc"
    fi
  fi
}

# Add a line to shell profile if the exact marker string is not found
ensure_in_profile() {
  local line="$1" marker="$2"
  local profile
  profile="$(get_shell_profile)"
  if [ -n "$profile" ] && ! grep -qF "$marker" "$profile" 2>/dev/null; then
    echo '' >> "$profile"
    echo "$line" >> "$profile"
  fi
}

# ─── Step 2: Install Bun ─────────────────────────────────────────

log_step "Checking Bun..."

# Ensure Bun's and Node's bins are in PATH (shell profile may not be sourced via curl | bash)
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$HOME/.node/bin:$BUN_INSTALL/bin:$PATH"

if command -v bun &>/dev/null; then
  BUN_VER=$(bun --version 2>/dev/null || echo "unknown")
  log_ok "Bun $BUN_VER already installed"
else
  echo "  Installing Bun (JavaScript runtime)..."
  curl -fsSL https://bun.sh/install | bash
  # Re-export PATH after Bun installer
  export PATH="$BUN_INSTALL/bin:$PATH"
  hash -r 2>/dev/null || true
  if command -v bun &>/dev/null; then
    log_ok "Bun $(bun --version) installed"
  else
    log_fail "Bun installation failed"
    echo "  Install manually: https://bun.sh"
    exit 1
  fi
fi

# Always ensure Bun PATH persists (even if bun was already installed but profile is broken)
ensure_in_profile 'export BUN_INSTALL="$HOME/.bun"' 'BUN_INSTALL="$HOME/.bun"'
ensure_in_profile 'export PATH="$BUN_INSTALL/bin:$PATH"' 'BUN_INSTALL/bin'

# ─── Step 3: Check Node.js (required by Claude CLI) ─────────────

log_step "Checking Node.js..."

# Validate node actually works (npm "node" package creates a fake binary)
node_works() {
  command -v node &>/dev/null && node --version &>/dev/null
}

# Download Node.js binary directly from nodejs.org (no package manager needed)
install_node_direct() {
  local node_dir="$HOME/.node"
  local os_name arch_name

  if [ "$OS" = "Darwin" ]; then os_name="darwin"; else os_name="linux"; fi
  if [ "$ARCH" = "arm64" ]; then arch_name="arm64"; else arch_name="x64"; fi

  # Get latest Node.js 22 LTS version
  local version
  version=$(curl -fsSL "https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt" 2>/dev/null \
    | grep -oE 'node-v[0-9]+\.[0-9]+\.[0-9]+' | head -1 | sed 's/node-//')

  if [ -z "$version" ]; then
    return 1
  fi

  local url="https://nodejs.org/dist/${version}/node-${version}-${os_name}-${arch_name}.tar.gz"

  mkdir -p "$node_dir"
  if ! curl -fsSL "$url" | tar -xz -C "$node_dir" --strip-components=1 2>/dev/null; then
    return 1
  fi

  export PATH="$node_dir/bin:$PATH"

  # Add to shell profile so node persists across sessions
  ensure_in_profile 'export PATH="$HOME/.node/bin:$PATH"' '.node/bin'

  return 0
}

if node_works; then
  NODE_VER=$(node --version 2>/dev/null)
  log_ok "Node.js $NODE_VER already installed"
else
  echo "  Node.js is required by Claude CLI."

  # Try package manager first (faster if available)
  if [ "$OS" = "Darwin" ] && command -v brew &>/dev/null; then
    echo "  Installing via Homebrew..."
    brew install node 2>/dev/null || true
  elif [ "$OS" = "Linux" ] && command -v apt-get &>/dev/null; then
    echo "  Installing via apt..."
    sudo apt-get install -y nodejs npm 2>/dev/null || true
  fi
  hash -r 2>/dev/null || true

  # Fallback: download binary directly from nodejs.org
  if ! node_works; then
    echo "  Downloading Node.js from nodejs.org..."
    install_node_direct
  fi

  if node_works; then
    log_ok "Node.js $(node --version) installed"
  else
    log_fail "Node.js installation failed"
    echo ""
    echo "  Install Node.js manually from: https://nodejs.org"
    echo ""
    echo "  After installing, re-run:"
    echo "    curl -fsSL https://justdobot.com/install.sh | bash"
    echo ""
    exit 1
  fi
fi

# ─── Step 4: Install Claude CLI ──────────────────────────────────

log_step "Checking Claude CLI..."

if command -v claude &>/dev/null; then
  CLAUDE_VER=$(claude --version 2>/dev/null || echo "unknown")
  log_ok "Claude CLI $CLAUDE_VER already installed"
else
  echo "  Installing Claude CLI..."
  if command -v npm &>/dev/null; then
    npm install -g @anthropic-ai/claude-code 2>/dev/null || true
  elif command -v bun &>/dev/null; then
    bun install -g @anthropic-ai/claude-code 2>/dev/null || true
  fi

  # Refresh PATH — global bins may be in a new location after install
  for p in \
    "$HOME/.bun/bin" \
    "$HOME/.bun/install/global/node_modules/.bin" \
    "$(bun pm bin -g 2>/dev/null || true)"; do
    [ -n "$p" ] && [ -d "$p" ] && export PATH="$p:$PATH"
  done
  hash -r 2>/dev/null || true

  if command -v claude &>/dev/null; then
    log_ok "Claude CLI installed"
  else
    log_warn "Claude CLI not found after install"
    echo "  Install manually: npm install -g @anthropic-ai/claude-code"
    echo "  Then run: claude login"
  fi
fi

# ─── Step 5: Claude authentication ──────────────────────────────

log_step "Checking Claude authentication..."

# Verify actual credentials, not just ~/.claude directory
check_claude_auth() {
  # macOS: check Keychain (matches detectClaudeCredentials() in setup-core.ts)
  if [ "$OS" = "Darwin" ]; then
    if security find-generic-password -s "Claude Code-credentials" -w &>/dev/null 2>&1; then
      return 0
    fi
  fi
  # Linux / fallback: check credentials files
  if [ -f "$HOME/.claude/.credentials.json" ]; then
    if grep -q "accessToken" "$HOME/.claude/.credentials.json" 2>/dev/null; then
      return 0
    fi
  fi
  if [ -f "$HOME/.claude/credentials.json" ]; then
    if grep -q "accessToken" "$HOME/.claude/credentials.json" 2>/dev/null; then
      return 0
    fi
  fi
  return 1
}

if check_claude_auth; then
  log_ok "Claude credentials verified"
else
  log_warn "Claude is not authenticated yet"
  echo "  You'll complete authentication in the setup panel (next step)."
fi

# ─── Step 6: Docker (optional — for Code Agent) ──────────────────

log_step "Checking Docker (optional — needed only for Code Agent)..."

if command -v docker &>/dev/null; then
  # Check if Docker daemon is running
  if docker info --format '{{.ServerVersion}}' &>/dev/null 2>&1; then
    DOCKER_VER=$(docker info --format '{{.ServerVersion}}' 2>/dev/null)
    log_ok "Docker $DOCKER_VER available and running"
  else
    log_warn "Docker installed but not running"
    if [ "$OS" = "Darwin" ]; then
      echo "  Start Docker Desktop from Applications if you plan to use Code Agent."
    else
      echo "  Start the Docker daemon: sudo systemctl start docker"
    fi
  fi
else
  echo "  Docker is NOT installed."
  echo "  Docker is only needed if you want the Code Agent feature"
  echo "  (sandboxed code execution). You can install it later."
  echo ""

  read -rp "  Install Docker now? (y/N): " install_docker </dev/tty

  if [[ "$install_docker" =~ ^[Yy]$ ]]; then
    if [ "$OS" = "Darwin" ]; then
      if command -v brew &>/dev/null; then
        echo "  Installing Docker Desktop via Homebrew..."
        if brew install --cask docker 2>/dev/null; then
          log_ok "Docker Desktop installed via Homebrew"
          echo "  Please launch Docker Desktop from Applications to start the daemon."
        else
          log_warn "Homebrew installation failed"
          echo "  Install manually: https://docs.docker.com/desktop/install/mac-install/"
        fi
      else
        log_warn "Homebrew not available"
        echo "  Install Docker Desktop from: https://docs.docker.com/desktop/install/mac-install/"
      fi
    elif [ "$OS" = "Linux" ]; then
      echo "  Installing Docker via get.docker.com..."
      if curl -fsSL https://get.docker.com | sh 2>/dev/null; then
        log_ok "Docker installed"
        # Add current user to docker group
        if ! groups | grep -q docker; then
          echo "  Adding you to the 'docker' group (may require logout/login to take effect)..."
          sudo usermod -aG docker "$USER" 2>/dev/null || true
        fi
      else
        log_warn "Docker installation failed"
        echo "  Install manually: https://docs.docker.com/engine/install/"
      fi
    fi
  else
    log_ok "Skipped (install later if you need Code Agent)"
  fi
fi

# ─── Step 7: Install dependencies ────────────────────────────────

log_step "Installing dependencies..."

# Determine if we're inside the repo or need to clone
if [ -f "package.json" ] && grep -q "justdobot" package.json 2>/dev/null; then
  log_ok "Already in JustDoBot directory"
elif [ -d "JustDoBot" ]; then
  cd JustDoBot
  log_ok "Found existing JustDoBot directory"
else
  echo "  Cloning repository..."
  git clone https://github.com/olegtestov/JustDoBot.git 2>/dev/null || {
    log_fail "Could not clone repository"
    echo "  Clone manually: git clone https://github.com/olegtestov/JustDoBot.git"
    exit 1
  }
  cd JustDoBot
  log_ok "Repository cloned"
fi

# Pull latest changes if this is a git repo
if [ -d ".git" ]; then
  BEFORE=$(git rev-parse HEAD 2>/dev/null)
  if git pull --ff-only origin main 2>/dev/null; then
    AFTER=$(git rev-parse HEAD 2>/dev/null)
    if [ "$BEFORE" = "$AFTER" ]; then
      log_ok "Already up to date"
    else
      COMMITS=$(git log --oneline "$BEFORE".."$AFTER" 2>/dev/null | wc -l | tr -d ' ')
      log_ok "Updated ($COMMITS new commit(s))"
    fi
  else
    log_warn "Could not auto-update (local changes?). Continuing with current version."
  fi
fi

echo "  Installing npm packages..."
if ! bun install --frozen-lockfile 2>&1; then
  log_warn "Lockfile mismatch — running bun install (lockfile will be updated)"
  bun install
fi
log_ok "Dependencies installed"

# macOS: install Homebrew SQLite for sqlite-vec (better extension support than bundled fallback)
if [ "$OS" = "Darwin" ] && command -v brew &>/dev/null; then
  if ! [ -f "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib" ] && \
     ! [ -f "/usr/local/opt/sqlite/lib/libsqlite3.dylib" ]; then
    echo "  Installing Homebrew SQLite (for semantic search)..."
    brew install sqlite 2>/dev/null || true
  fi
fi

# Auto-install ffmpeg (needed for Gemini TTS: PCM → OGG conversion)
if ! command -v ffmpeg &>/dev/null; then
  echo "  Installing ffmpeg (for voice features)..."
  if [ "$OS" = "Darwin" ] && command -v brew &>/dev/null; then
    brew install ffmpeg 2>/dev/null || log_warn "Could not install ffmpeg via Homebrew"
  elif command -v apt-get &>/dev/null; then
    sudo apt-get install -y --no-install-recommends ffmpeg 2>/dev/null || log_warn "Could not install ffmpeg via apt"
  else
    log_warn "ffmpeg not found — install manually for Gemini voice features"
  fi
  if command -v ffmpeg &>/dev/null; then
    log_ok "ffmpeg installed"
  fi
else
  log_ok "ffmpeg already installed"
fi

# ─── Step 8: Start setup panel ───────────────────────────────────

log_step "Starting setup panel..."

JUSTDOBOT_DIR="$(pwd)"

echo ""
echo -e "${GREEN}${BOLD}  Installation complete!${NC}"
echo ""

# Show run instructions BEFORE web-setup (Ctrl+C kills the whole curl|bash pipeline)
echo -e "  ${BOLD}────────────────────────────────────────${NC}"
echo ""
echo -e "  ${GREEN}${BOLD}After setup, to start the bot:${NC}"
echo ""
echo -e "  ${BOLD}1.${NC} Open a ${BOLD}new${NC} Terminal window"
echo -e "  ${BOLD}2.${NC} Run:"
echo ""
echo -e "    cd ${JUSTDOBOT_DIR} && bun run start"
echo ""
echo -e "  ${BOLD}────────────────────────────────────────${NC}"
echo ""
echo "  Opening the setup panel in your browser..."
echo "  If the browser doesn't open, visit the URL shown below."
echo ""

# Start web-setup (Ctrl+C will exit the entire script — instructions already shown above)
bun run web-setup 2>/dev/null || true
