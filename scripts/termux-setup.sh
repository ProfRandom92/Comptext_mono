#!/data/data/com.termux/files/usr/bin/bash
# CompText — Termux Offline Setup
# Usage: bash termux-setup.sh
set -euo pipefail

REPO_URL="https://github.com/ProfRandom92/Comptext_mono.git"
INSTALL_DIR="$HOME/comptext"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   CompText DSL v5 — Termux Setup         ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# 1. Install system packages
echo "[1/5] Installing system packages..."
pkg update -y -q
pkg install -y nodejs git 2>/dev/null || {
  echo "Error: could not install packages. Run 'pkg update' manually first."
  exit 1
}

# 2. Clone or update repository
echo "[2/5] Setting up repository..."
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "      Found existing install, pulling latest..."
  cd "$INSTALL_DIR"
  git pull --ff-only || echo "      (pull failed, using existing version)"
else
  echo "      Cloning from GitHub..."
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# 3. Install npm dependencies (prefer cache for offline)
echo "[3/5] Installing npm dependencies..."
npm install --prefer-offline --no-audit --no-fund 2>&1 | grep -v "^npm warn"

# 4. Build all packages
echo "[4/5] Building packages..."
npm run build -w packages/core        2>&1 | grep -E "Build success|error" || true
npm run build -w packages/cli         2>&1 | grep -E "Build success|error" || true
npm run build -w packages/mcp-server  2>&1 | grep -E "Build success|error" || true
npm run build -w packages/visualizer  2>&1 | grep -E "Build success|error" || true

# 5. Link CLI globally
echo "[5/5] Linking comptext CLI..."
cd "$INSTALL_DIR/packages/cli"
npm link 2>/dev/null || {
  # Fallback: add alias to shell profile
  SHELL_RC="$HOME/.bashrc"
  [ -f "$HOME/.zshrc" ] && SHELL_RC="$HOME/.zshrc"
  ALIAS_LINE="alias comptext='node $INSTALL_DIR/packages/cli/dist/index.js'"
  grep -qF "alias comptext=" "$SHELL_RC" 2>/dev/null || echo "$ALIAS_LINE" >> "$SHELL_RC"
  echo "      CLI alias added to $SHELL_RC"
  echo "      Run: source $SHELL_RC"
}

# Done
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   Setup complete!                        ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "Commands:"
echo "  comptext run stemi              # Run STEMI scenario, print DSL"
echo "  comptext run sepsis             # Run Sepsis scenario"
echo "  comptext benchmark              # Full benchmark table"
echo "  comptext serve                  # Visualizer → http://localhost:4000"
echo "  comptext pipe < bundle.json     # Process a FHIR bundle file"
echo "  npm run test -w packages/core   # Run all 28 tests"
echo ""
echo "MCP server (for Claude Desktop):"
echo "  node $INSTALL_DIR/packages/mcp-server/dist/index.js"
echo ""
