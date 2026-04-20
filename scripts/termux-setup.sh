#!/usr/bin/env bash
# CompText DSL v5 — Termux Einrichtung
# Nutzung: bash termux-setup.sh
set -euo pipefail

# ANSI-Farben (werden ignoriert wenn kein Farb-Terminal)
if [ -t 1 ] && [ "${NO_COLOR:-}" != "1" ]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
  CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; RESET='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; CYAN=''; BOLD=''; DIM=''; RESET=''
fi

REPO_URL="${REPO_URL:-https://github.com/ProfRandom92/Comptext_mono.git}"
INSTALL_DIR="$HOME/comptext"

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${CYAN}║${RESET}   ${BOLD}CompText DSL v5 — Termux Einrichtung${RESET}          ${CYAN}║${RESET}"
echo -e "${CYAN}║${RESET}   ${DIM}ePA · PHI-Scrubbing · DSL · LLM-Notfallhilfe${RESET}  ${CYAN}║${RESET}"
echo -e "${CYAN}╚══════════════════════════════════════════════════╝${RESET}"
echo ""

# 1. Systempakete installieren
echo -e "${BOLD}[1/5]${RESET} Systempakete installieren..."
if command -v pkg &>/dev/null; then
  pkg update -y -q
  pkg install -y nodejs git 2>/dev/null || {
    echo -e "${RED}Fehler: Pakete konnten nicht installiert werden.${RESET}"
    echo -e "${DIM}Bitte 'pkg update' manuell ausführen.${RESET}"
    exit 1
  }
else
  echo -e "${DIM}Kein Termux 'pkg' gefunden — überspringe (Node.js wird vorausgesetzt).${RESET}"
fi

# Node.js prüfen
node --version &>/dev/null || {
  echo -e "${RED}Fehler: Node.js nicht gefunden. Bitte installieren.${RESET}"
  exit 1
}
echo -e "      ${GREEN}✓${RESET} Node.js $(node --version)"

# 2. Repository klonen oder aktualisieren
echo -e "${BOLD}[2/5]${RESET} Repository einrichten..."
if [ -d "$INSTALL_DIR/.git" ]; then
  echo -e "      ${DIM}Bestehende Installation gefunden — aktualisiere...${RESET}"
  cd "$INSTALL_DIR"
  git pull --ff-only 2>/dev/null || echo -e "      ${YELLOW}(Pull fehlgeschlagen — nutze vorhandene Version)${RESET}"
else
  echo -e "      ${DIM}Klone von GitHub...${RESET}"
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi
echo -e "      ${GREEN}✓${RESET} Repository bereit: $INSTALL_DIR"

# 3. npm-Abhängigkeiten installieren
echo -e "${BOLD}[3/5]${RESET} npm-Abhängigkeiten installieren..."
cd "$INSTALL_DIR"
npm install --prefer-offline --no-audit --no-fund 2>&1 | grep -v "^npm warn" || true
echo -e "      ${GREEN}✓${RESET} Abhängigkeiten installiert"

# 4. Alle Pakete bauen
echo -e "${BOLD}[4/5]${RESET} Pakete bauen..."
npm run build -w packages/core        || { echo -e "${RED}Fehler: packages/core${RESET}";        exit 1; }
echo -e "      ${GREEN}✓${RESET} packages/core"
npm run build -w packages/cli         || { echo -e "${RED}Fehler: packages/cli${RESET}";         exit 1; }
echo -e "      ${GREEN}✓${RESET} packages/cli"
npm run build -w packages/mcp-server  || { echo -e "${RED}Fehler: packages/mcp-server${RESET}";  exit 1; }
echo -e "      ${GREEN}✓${RESET} packages/mcp-server"
npm run build -w packages/visualizer  || { echo -e "${RED}Fehler: packages/visualizer${RESET}"; exit 1; }
echo -e "      ${GREEN}✓${RESET} packages/visualizer"

# 5. CLI global verlinken
echo -e "${BOLD}[5/5]${RESET} CLI einrichten..."
cd "$INSTALL_DIR/packages/cli"
npm link 2>/dev/null && echo -e "      ${GREEN}✓${RESET} 'comptext' global verfügbar (npm link)" || {
  SHELL_RC="$HOME/.bashrc"
  [ -f "$HOME/.zshrc" ] && SHELL_RC="$HOME/.zshrc"
  ALIAS_LINE="alias comptext='node \"${INSTALL_DIR}/packages/cli/dist/index.js\"'"
  grep -qF "alias comptext=" "$SHELL_RC" 2>/dev/null || echo "$ALIAS_LINE" >> "$SHELL_RC"
  echo -e "      ${YELLOW}Alias hinzugefügt zu $SHELL_RC${RESET}"
  echo -e "      ${DIM}Ausführen: source $SHELL_RC${RESET}"
}

# Abschluss
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${GREEN}║${RESET}   ${BOLD}Einrichtung abgeschlossen!${RESET}                     ${GREEN}║${RESET}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "${BOLD}Notfall-Commands:${RESET}"
echo -e "  ${CYAN}comptext menu${RESET}                     ${DIM}# Interaktives Menü${RESET}"
echo -e "  ${RED}comptext emergency stemi${RESET}          ${DIM}# 🫀 STEMI Notfall-Ansicht${RESET}"
echo -e "  ${RED}comptext emergency sepsis${RESET}         ${DIM}# 🦠 Sepsis Notfall-Ansicht${RESET}"
echo -e "  ${RED}comptext simulate stroke${RESET}          ${DIM}# 🧠 Schlaganfall Schritt-für-Schritt${RESET}"
echo -e "  ${YELLOW}comptext epa anaphylaxie${RESET}          ${DIM}# ⚠️  Nur ePA-Daten anzeigen${RESET}"
echo ""
echo -e "${BOLD}Technische Commands:${RESET}"
echo -e "  ${DIM}comptext run stemi${RESET}                ${DIM}# DSL-Output auf stdout${RESET}"
echo -e "  ${DIM}comptext benchmark${RESET}                ${DIM}# Token-Reduktions-Tabelle${RESET}"
echo -e "  ${DIM}comptext serve${RESET}                    ${DIM}# Visualizer → http://localhost:4000${RESET}"
echo -e "  ${DIM}npm run test -w packages/core${RESET}     ${DIM}# Alle Tests ausführen${RESET}"
echo ""
echo -e "${DIM}MCP-Server (für Claude Desktop):${RESET}"
echo -e "  ${DIM}node ${INSTALL_DIR}/packages/mcp-server/dist/index.js${RESET}"
echo ""
