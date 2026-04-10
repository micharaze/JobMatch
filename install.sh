#!/usr/bin/env bash
# =============================================================================
#  JobCheck — Interactive Installer
#  Sets up the LLM backend (Ollama or Gemini API) and pulls the AI models
#  required for the pipeline.
# =============================================================================

set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m' # No Colour

# ── Helpers ───────────────────────────────────────────────────────────────────
print_header() {
  echo ""
  echo -e "${BOLD}${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}${BLUE}║            JobCheck — AI Model Installer                 ║${NC}"
  echo -e "${BOLD}${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
  echo ""
}

print_section() {
  echo ""
  echo -e "${BOLD}${CYAN}▶ $1${NC}"
  echo -e "${DIM}──────────────────────────────────────────────${NC}"
}

print_ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
print_warn() { echo -e "  ${YELLOW}⚠${NC}  $1"; }
print_err()  { echo -e "  ${RED}✗${NC} $1"; }
print_info() { echo -e "  ${BLUE}ℹ${NC}  $1"; }

ask_yn() {
  # ask_yn "Question" [default: y|n]
  local prompt="$1"
  local default="${2:-y}"
  local hint
  if [[ "$default" == "y" ]]; then hint="[Y/n]"; else hint="[y/N]"; fi
  while true; do
    echo -en "  ${BOLD}$prompt${NC} ${DIM}$hint${NC} "
    read -r reply
    reply="${reply:-$default}"
    case "$reply" in
      [Yy]*) return 0 ;;
      [Nn]*) return 1 ;;
      *) echo -e "  ${YELLOW}Please answer y or n.${NC}" ;;
    esac
  done
}

ask_choice() {
  # ask_choice "prompt" option1 option2 ...  → sets CHOICE (1-based index)
  local prompt="$1"; shift
  local options=("$@")
  while true; do
    local i=1
    for opt in "${options[@]}"; do
      echo -e "    ${BOLD}[$i]${NC} $opt"
      ((i++))
    done
    echo -en "  ${BOLD}$prompt${NC} ${DIM}[1-${#options[@]}]${NC} "
    read -r reply
    if [[ "$reply" =~ ^[0-9]+$ ]] && (( reply >= 1 && reply <= ${#options[@]} )); then
      CHOICE="$reply"
      return 0
    fi
    echo -e "  ${YELLOW}Please enter a number between 1 and ${#options[@]}.${NC}"
  done
}

ask_text() {
  # ask_text "prompt" → sets TEXT_INPUT
  local prompt="$1"
  echo -en "  ${BOLD}$prompt${NC} "
  read -r TEXT_INPUT
}

# ── System detection ──────────────────────────────────────────────────────────
detect_os() {
  case "$(uname -s)" in
    Darwin) OS="macos" ;;
    Linux)  OS="linux" ;;
    *)      OS="unknown" ;;
  esac
}

get_ram_gb() {
  local ram=0
  if [[ "$OS" == "macos" ]]; then
    ram=$(( $(sysctl -n hw.memsize) / 1024 / 1024 / 1024 ))
  elif [[ "$OS" == "linux" ]]; then
    ram=$(awk '/MemTotal/ { printf "%d", $2/1024/1024 }' /proc/meminfo)
  fi
  echo "$ram"
}

get_free_disk_gb() {
  if [[ "$OS" == "macos" ]]; then
    df -k . 2>/dev/null | awk 'NR==2 { printf "%d", $4/1024/1024 }' || echo "0"
  else
    df -BG . 2>/dev/null | awk 'NR==2 { gsub("G",""); print $4 }' || echo "0"
  fi
}

# ── Ollama ────────────────────────────────────────────────────────────────────
ollama_installed() {
  command -v ollama &>/dev/null
}

install_ollama() {
  print_section "Installing Ollama"
  if [[ "$OS" == "macos" ]]; then
    if command -v brew &>/dev/null; then
      print_info "Installing via Homebrew…"
      brew install ollama
    else
      print_info "Downloading Ollama installer for macOS…"
      curl -fsSL https://ollama.com/install.sh | sh
    fi
  elif [[ "$OS" == "linux" ]]; then
    print_info "Downloading Ollama installer for Linux…"
    curl -fsSL https://ollama.com/install.sh | sh
  else
    print_err "Unsupported OS. Please install Ollama manually from https://ollama.com"
    exit 1
  fi
  print_ok "Ollama installed."
}

ensure_ollama_running() {
  if ! ollama list &>/dev/null 2>&1; then
    print_info "Starting Ollama daemon…"
    ollama serve &>/dev/null &
    sleep 3
  fi
}

# ── Model table display ───────────────────────────────────────────────────────
# Format: "id|display_name|size_gb|min_ram_gb|description"
parse_model_id()   { echo "$1" | cut -d'|' -f1 | tr -d ' '; }
parse_model_name() { echo "$1" | cut -d'|' -f2; }
parse_model_size() { echo "$1" | cut -d'|' -f3; }
parse_model_ram()  { echo "$1" | cut -d'|' -f4; }
parse_model_desc() { echo "$1" | cut -d'|' -f5; }

show_model_table() {
  local title="$1"; shift
  local models=("$@")
  echo ""
  echo -e "  ${BOLD}$title${NC}"
  echo ""
  printf "  %-3s %-26s %-10s %-8s %s\n" "#" "Model" "Download" "Min RAM" "Notes"
  echo -e "  ${DIM}$(printf '%.0s─' {1..76})${NC}"
  local i=1
  for m in "${models[@]}"; do
    local name size ram desc
    name=$(parse_model_name "$m")
    size=$(parse_model_size "$m")
    ram=$(parse_model_ram "$m")
    desc=$(parse_model_desc "$m")
    printf "  ${BOLD}%-3s${NC} %-26s ${CYAN}%-10s${NC} ${YELLOW}%-8s${NC} ${DIM}%s${NC}\n" \
      "[$i]" "$name" "$size" "$ram" "$desc"
    ((i++))
  done
}

# ── .env writer ───────────────────────────────────────────────────────────────
write_env() {
  local provider="$1"
  local llm_model="$2"
  local gemini_api_key="${3:-}"

  mkdir -p services/normalizer services/matcher

  if [[ "$provider" == "gemini" ]]; then
    # ── Gemini provider ───────────────────────────────────────────────────────
    local llm_block
    llm_block=$(cat <<EOF
# ── LLM provider ─────────────────────────────────────────────────────────────
LLM_PROVIDER=gemini
GEMINI_API_KEY=${gemini_api_key}
NORMALIZER_MODEL=${llm_model}
MATCHER_MODEL=${llm_model}
EOF
)
    echo "$llm_block" > services/normalizer/.env
    echo "$llm_block" > services/matcher/.env

    cat > ".env" <<EOF
# ── JobCheck — root environment ───────────────────────────────────────────────
LLM_PROVIDER=gemini
GEMINI_API_KEY=${gemini_api_key}
NORMALIZER_MODEL=${llm_model}
MATCHER_MODEL=${llm_model}
EOF

  else
    # ── Ollama provider ───────────────────────────────────────────────────────
    local llm_block
    llm_block=$(cat <<EOF
# ── LLM provider ─────────────────────────────────────────────────────────────
LLM_PROVIDER=ollama
# Base URL for the OpenAI-compatible Ollama API
GEMMA_BASE_URL=http://localhost:11434/v1
# Ollama doesn't require a real API key — any non-empty value works
GEMMA_API_KEY=ollama
NORMALIZER_MODEL=${llm_model}
MATCHER_MODEL=${llm_model}
EOF
)
    echo "$llm_block" > services/normalizer/.env
    echo "$llm_block" > services/matcher/.env

    cat > ".env" <<EOF
# ── JobCheck — root environment ───────────────────────────────────────────────
LLM_PROVIDER=ollama
GEMMA_BASE_URL=http://localhost:11434/v1
GEMMA_API_KEY=ollama
NORMALIZER_MODEL=${llm_model}
MATCHER_MODEL=${llm_model}
EOF
  fi

  print_ok "Written: services/normalizer/.env"
  print_ok "Written: services/matcher/.env"
  print_ok "Written: .env (root)"
}

# ═════════════════════════════════════════════════════════════════════════════
#  MAIN
# ═════════════════════════════════════════════════════════════════════════════
print_header
detect_os

# ── System info ───────────────────────────────────────────────────────────────
print_section "System check"

RAM_GB=$(get_ram_gb)
DISK_GB=$(get_free_disk_gb)

print_info "Operating system : $OS"
print_info "RAM detected     : ${RAM_GB} GB"
print_info "Free disk space  : ${DISK_GB} GB"

if (( RAM_GB > 0 && RAM_GB < 4 )); then
  print_warn "You have less than 4 GB RAM. Only the smallest local models are recommended."
elif (( RAM_GB >= 4 && RAM_GB < 8 )); then
  print_warn "You have ${RAM_GB} GB RAM. gemma4:e2b is the safer choice for local extraction."
else
  print_ok "RAM looks sufficient for all available models."
fi

if (( DISK_GB < 5 )); then
  print_warn "Less than 5 GB free disk space. Local models may not fit."
fi

# ── LLM backend selection ─────────────────────────────────────────────────────
print_section "LLM backend  (normalization & matching)"
echo ""
echo -e "  Choose how to run the ${BOLD}Gemma model for normalization and matching${NC}."
echo ""

ask_choice "Which LLM backend do you want to use?" \
  "Ollama  — local, private, no API key required" \
  "Gemini API  — cloud, requires a Google API key"

LLM_BACKEND=$CHOICE
SELECTED_EXTRACT_ID=""
GEMINI_KEY=""

# ── Ollama path ───────────────────────────────────────────────────────────────
if (( LLM_BACKEND == 1 )); then

  print_section "Ollama"

  if ollama_installed; then
    OLLAMA_VER=$(ollama --version 2>/dev/null || echo "unknown")
    print_ok "Ollama is already installed ($OLLAMA_VER)."
  else
    print_warn "Ollama is not installed."
    echo ""
    echo -e "  Ollama is a local AI model runner. It provides the REST API"
    echo -e "  that JobCheck uses to run Gemma 4 and the embedding model."
    echo -e "  ${DIM}https://ollama.com${NC}"
    echo ""
    if ask_yn "Install Ollama now?"; then
      install_ollama
    else
      print_err "Ollama is required for local models. Exiting."
      exit 1
    fi
  fi

  ensure_ollama_running

  # Normalization / Matching model selection (Ollama)
  print_section "Normalization & Matching model  (Gemma 4)"
  echo ""
  echo -e "  This model ${BOLD}normalizes job postings and CVs${NC} into compact profiles"
  echo -e "  and scores CV-to-job matches with reasoning."

  OLLAMA_EXTRACT_MODELS=(
    "gemma4:e4b|gemma4:e4b  (4B params)|~3.5 GB|8 GB |★ Recommended — best accuracy, fits most hardware"
    "gemma4:e2b|gemma4:e2b  (2B params)|~2.0 GB|4 GB |Lighter option — slightly lower accuracy, faster"
  )

  show_model_table "Choose a model:" "${OLLAMA_EXTRACT_MODELS[@]}"
  echo ""

  if (( RAM_GB > 0 && RAM_GB < 8 )); then
    print_warn "Based on your RAM (${RAM_GB} GB), option [2] (e2b) is pre-selected."
  fi

  ask_choice "Which extraction model?" \
    "$(parse_model_name "${OLLAMA_EXTRACT_MODELS[0]}")" \
    "$(parse_model_name "${OLLAMA_EXTRACT_MODELS[1]}")" \
    "Custom — enter a model name manually" \
    "Skip — I will install it manually"

  EXTRACT_CHOICE=$CHOICE

  case $EXTRACT_CHOICE in
    1|2)
      SELECTED_EXTRACT_ID=$(parse_model_id "${OLLAMA_EXTRACT_MODELS[$((EXTRACT_CHOICE-1))]}")
      SELECTED_EXTRACT_SIZE=$(parse_model_size "${OLLAMA_EXTRACT_MODELS[$((EXTRACT_CHOICE-1))]}")
      echo ""
      print_info "Selected: ${SELECTED_EXTRACT_ID}  (download: ${SELECTED_EXTRACT_SIZE})"
      if ask_yn "Pull ${SELECTED_EXTRACT_ID} now?"; then
        echo ""
        ollama pull "$SELECTED_EXTRACT_ID"
        print_ok "${SELECTED_EXTRACT_ID} ready."
      else
        print_warn "Skipped. Run 'ollama pull ${SELECTED_EXTRACT_ID}' later."
      fi
      ;;
    3)
      ask_text "Enter Ollama model name (e.g. llama3.2, mistral, phi4):"
      SELECTED_EXTRACT_ID="$TEXT_INPUT"
      echo ""
      print_info "Custom model: ${SELECTED_EXTRACT_ID}"
      if ask_yn "Pull ${SELECTED_EXTRACT_ID} now?"; then
        echo ""
        ollama pull "$SELECTED_EXTRACT_ID"
        print_ok "${SELECTED_EXTRACT_ID} ready."
      else
        print_warn "Skipped. Run 'ollama pull ${SELECTED_EXTRACT_ID}' later."
      fi
      ;;
    4)
      print_info "Skipping extraction model — remember to pull one manually."
      ;;
  esac

# ── Gemini path ───────────────────────────────────────────────────────────────
else

  print_section "Gemini API"
  echo ""
  echo -e "  JobCheck will use the ${BOLD}Google Gemini API${NC} for extraction and validation."
  echo -e "  You need a Gemini API key from ${CYAN}https://aistudio.google.com/apikey${NC}"
  echo -e "  The embedding model still runs locally via Ollama."
  echo ""

  while true; do
    ask_text "Enter your Gemini API key:"
    GEMINI_KEY="$TEXT_INPUT"
    if [[ -n "$GEMINI_KEY" ]]; then
      break
    fi
    print_warn "API key cannot be empty."
  done

  print_ok "API key saved."

  # Gemini model selection
  echo ""
  GEMINI_MODELS=(
    "gemma-4-31b-it |gemma-4-31b-it   |cloud|—    |★ Recommended — good quality at low cost"
    "gemini-2.0-flash|gemini-2.0-flash |cloud|—    |Fast and cheap — great for high volume"
    "gemini-1.5-pro  |gemini-1.5-pro   |cloud|—    |Most capable — higher cost per request"
  )

  show_model_table "Choose a Gemini model:" "${GEMINI_MODELS[@]}"
  echo ""

  ask_choice "Which model?" \
    "$(parse_model_name "${GEMINI_MODELS[0]}")" \
    "$(parse_model_name "${GEMINI_MODELS[1]}")" \
    "$(parse_model_name "${GEMINI_MODELS[2]}")" \
    "Custom — enter a model name manually"

  GEMINI_MODEL_CHOICE=$CHOICE

  if (( GEMINI_MODEL_CHOICE <= ${#GEMINI_MODELS[@]} )); then
    SELECTED_EXTRACT_ID=$(parse_model_id "${GEMINI_MODELS[$((GEMINI_MODEL_CHOICE-1))]}")
  else
    ask_text "Enter model name (e.g. gemini-2.0-flash-exp, gemma-3-27b-it):"
    SELECTED_EXTRACT_ID="$TEXT_INPUT"
  fi

  echo ""
  print_info "Selected model: ${SELECTED_EXTRACT_ID}"

fi

# ── .env files ────────────────────────────────────────────────────────────────
print_section "Configuration"

FINAL_PROVIDER="ollama"
if (( LLM_BACKEND == 2 )); then FINAL_PROVIDER="gemini"; fi

FINAL_MODEL="${SELECTED_EXTRACT_ID:-gemma4:e4b}"

echo ""
print_info "LLM provider : ${FINAL_PROVIDER}"
print_info "Model        : ${FINAL_MODEL}"
echo ""

if ask_yn "Write .env files now?"; then
  write_env "$FINAL_PROVIDER" "$FINAL_MODEL" "$GEMINI_KEY"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║                    Setup complete!                       ║${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Configuration:${NC}"
print_info "LLM provider : $FINAL_PROVIDER"
if [[ "$FINAL_PROVIDER" == "gemini" ]]; then
  print_ok "Model        : $FINAL_MODEL  (via Gemini API)"
else
  if [[ -n "$SELECTED_EXTRACT_ID" ]]; then
    print_ok "Model        : $SELECTED_EXTRACT_ID  (Ollama local)"
  else
    print_warn "Model        : not installed — run 'ollama pull gemma4:e4b'"
  fi
fi
echo ""
echo -e "  ${BOLD}Next steps:${NC}"
echo -e "  ${DIM}1.${NC} Install Node dependencies:    ${CYAN}npm install${NC}"
echo -e "  ${DIM}2.${NC} Start all services:           ${CYAN}docker compose up${NC}"
echo -e "  ${DIM}   or run a single service:      ${CYAN}cd services/scraper && npm run dev${NC}"
echo ""
