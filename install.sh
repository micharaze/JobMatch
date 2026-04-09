#!/usr/bin/env bash
# =============================================================================
#  JobCheck — Interactive Installer
#  Sets up Ollama and pulls the AI models required for the pipeline.
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

# ── Model definitions ─────────────────────────────────────────────────────────
# Format: "id|display_name|size_gb|min_ram_gb|description"
EXTRACT_MODELS=(
  "gemma4:e4b|gemma4:e4b  (4B params)|~3.5 GB|8 GB |★ Recommended — best accuracy for skill extraction"
  "gemma4:e2b|gemma4:e2b  (2B params)|~2.0 GB|4 GB |Lighter option — slightly lower accuracy, faster"
)

EMBED_MODELS=(
  "embeddinggemma    |embeddinggemma (300M)|~622 MB|2 GB |★ Recommended — Google Gemma family, built for retrieval & semantic similarity, 100+ languages"
  "mxbai-embed-large |mxbai-embed-large   |~670 MB|2 GB |Top MTEB retrieval score — purpose-built for query/passage asymmetric search"
  "nomic-embed-text  |nomic-embed-text    |~274 MB|1 GB |Lightweight — good quality, smallest footprint"
)

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
  printf "  %-3s %-22s %-10s %-8s %s\n" "#" "Model" "Download" "Min RAM" "Notes"
  echo -e "  ${DIM}$(printf '%.0s─' {1..72})${NC}"
  local i=1
  for m in "${models[@]}"; do
    local name size ram desc
    name=$(parse_model_name "$m")
    size=$(parse_model_size "$m")
    ram=$(parse_model_ram "$m")
    desc=$(parse_model_desc "$m")
    printf "  ${BOLD}%-3s${NC} %-22s ${CYAN}%-10s${NC} ${YELLOW}%-8s${NC} ${DIM}%s${NC}\n" \
      "[$i]" "$name" "$size" "$ram" "$desc"
    ((i++))
  done
}

# ── .env writer ───────────────────────────────────────────────────────────────
write_env() {
  local extract_model="$1"
  local embed_model="$2"
  local env_file="services/extractor/.env"

  mkdir -p services/extractor

  cat > "$env_file" <<EOF
# ── Ollama / LLM settings ─────────────────────────────────────────────────────
# Base URL for the OpenAI-compatible Ollama API
GEMMA_BASE_URL=http://localhost:11434/v1
# Ollama doesn't require a real API key — any non-empty value works
GEMMA_API_KEY=ollama
GEMMA_MODEL=${extract_model}

# ── Embedding model ───────────────────────────────────────────────────────────
EMBEDDING_BASE_URL=http://localhost:11434/v1
EMBEDDING_API_KEY=ollama
EMBEDDING_MODEL=${embed_model}
EOF

  # Also write a shared root .env for services that need both
  cat > ".env" <<EOF
# ── JobCheck — root environment ───────────────────────────────────────────────
# Copy relevant variables into service-specific .env files as needed.

GEMMA_BASE_URL=http://localhost:11434/v1
GEMMA_API_KEY=ollama
GEMMA_MODEL=${extract_model}

EMBEDDING_BASE_URL=http://localhost:11434/v1
EMBEDDING_API_KEY=ollama
EMBEDDING_MODEL=${embed_model}
EOF

  print_ok "Written: $env_file"
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
  print_warn "You have less than 4 GB RAM. Only the smallest models are recommended."
elif (( RAM_GB >= 4 && RAM_GB < 8 )); then
  print_warn "You have ${RAM_GB} GB RAM. gemma4:e2b is the safer choice for the extraction model."
else
  print_ok "RAM looks sufficient for all available models."
fi

if (( DISK_GB < 5 )); then
  print_warn "Less than 5 GB free disk space. Models may not fit."
fi

# ── Ollama ────────────────────────────────────────────────────────────────────
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
    print_err "Ollama is required. Exiting."
    exit 1
  fi
fi

ensure_ollama_running

# ── Extraction model ──────────────────────────────────────────────────────────
print_section "Extraction / Validation model  (Gemma 4)"
echo ""
echo -e "  This model runs ${BOLD}skill extraction from job postings and CVs${NC}"
echo -e "  and validates/re-ranks candidate matches (pipeline steps 2 & 5)."

show_model_table "Choose a model:" "${EXTRACT_MODELS[@]}"
echo ""

# Pre-select recommendation based on RAM
DEFAULT_EXTRACT=1
if (( RAM_GB > 0 && RAM_GB < 8 )); then
  DEFAULT_EXTRACT=2
  print_warn "Based on your RAM (${RAM_GB} GB), option [2] (e2b) is pre-selected."
fi

ask_choice "Which extraction model do you want to install?" \
  "$(parse_model_name "${EXTRACT_MODELS[0]}")" \
  "$(parse_model_name "${EXTRACT_MODELS[1]}")" \
  "Skip — I will install it manually"

EXTRACT_CHOICE=$CHOICE
SELECTED_EXTRACT_ID=""

if (( EXTRACT_CHOICE <= ${#EXTRACT_MODELS[@]} )); then
  SELECTED_EXTRACT_ID=$(parse_model_id "${EXTRACT_MODELS[$((EXTRACT_CHOICE-1))]}")
  SELECTED_EXTRACT_SIZE=$(parse_model_size "${EXTRACT_MODELS[$((EXTRACT_CHOICE-1))]}")
  echo ""
  print_info "Selected: ${SELECTED_EXTRACT_ID}  (download: ${SELECTED_EXTRACT_SIZE})"
  if ask_yn "Pull ${SELECTED_EXTRACT_ID} now?"; then
    echo ""
    ollama pull "$SELECTED_EXTRACT_ID"
    print_ok "${SELECTED_EXTRACT_ID} ready."
  else
    print_warn "Skipped. Run 'ollama pull ${SELECTED_EXTRACT_ID}' later."
  fi
else
  print_info "Skipping extraction model — remember to pull one manually."
fi

# ── Embedding model ───────────────────────────────────────────────────────────
print_section "Embedding model"
echo ""
echo -e "  This model encodes job skills and CV skills as vectors for"
echo -e "  semantic similarity search (pipeline steps 3 & 4)."
echo ""
echo -e "  ${BOLD}Note:${NC} The pipeline uses asymmetric encoding:"
echo -e "  ${DIM}  job skill lookups   →  \"query: <text>\"${NC}"
echo -e "  ${DIM}  stored skills (DB)  →  \"passage: <text>\"${NC}"
echo ""
echo -e "  ${BOLD}[1] embeddinggemma${NC} is recommended — Google's dedicated embedding model"
echo -e "  from the Gemma family (same architecture as the extraction model)."
echo -e "  300M params, 622 MB, built for retrieval & semantic similarity,"
echo -e "  supports 100+ languages including German. Requires Ollama ≥ v0.11.10."
echo -e "  ${BOLD}[2] mxbai-embed-large${NC} is the best-benchmarked alternative (top MTEB"
echo -e "  retrieval score), purpose-built for query/passage asymmetric search."

show_model_table "Choose an embedding model:" "${EMBED_MODELS[@]}"
echo ""

ask_choice "Which embedding model do you want to install?" \
  "$(parse_model_name "${EMBED_MODELS[0]}")" \
  "$(parse_model_name "${EMBED_MODELS[1]}")" \
  "$(parse_model_name "${EMBED_MODELS[2]}")" \
  "Skip — I will install it manually"

EMBED_CHOICE=$CHOICE
SELECTED_EMBED_ID=""

if (( EMBED_CHOICE <= ${#EMBED_MODELS[@]} )); then
  SELECTED_EMBED_ID=$(parse_model_id "${EMBED_MODELS[$((EMBED_CHOICE-1))]}")
  SELECTED_EMBED_SIZE=$(parse_model_size "${EMBED_MODELS[$((EMBED_CHOICE-1))]}")
  echo ""
  print_info "Selected: ${SELECTED_EMBED_ID}  (download: ${SELECTED_EMBED_SIZE})"

  if ask_yn "Pull ${SELECTED_EMBED_ID} now?"; then
    echo ""
    ollama pull "$SELECTED_EMBED_ID"
    print_ok "${SELECTED_EMBED_ID} ready."
  else
    print_warn "Skipped. Run 'ollama pull ${SELECTED_EMBED_ID}' later."
  fi
else
  print_info "Skipping embedding model — remember to pull one manually."
fi

# ── .env files ────────────────────────────────────────────────────────────────
print_section "Configuration"

FINAL_EXTRACT="${SELECTED_EXTRACT_ID:-gemma4:e4b}"
FINAL_EMBED="${SELECTED_EMBED_ID:-embeddinggemma}"

echo ""
print_info "Writing .env files with selected models:"
print_info "  Extraction model : ${FINAL_EXTRACT}"
print_info "  Embedding model  : ${FINAL_EMBED}"
echo ""

if ask_yn "Write .env files now?"; then
  write_env "$FINAL_EXTRACT" "$FINAL_EMBED"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║                    Setup complete!                       ║${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Installed models:${NC}"
if [[ -n "$SELECTED_EXTRACT_ID" ]]; then
  print_ok "Extraction : $SELECTED_EXTRACT_ID"
else
  print_warn "Extraction : not installed — run 'ollama pull gemma4:e4b'"
fi
if [[ -n "$SELECTED_EMBED_ID" ]]; then
  print_ok "Embedding  : $SELECTED_EMBED_ID"
else
  print_warn "Embedding  : not installed — run 'ollama pull mxbai-embed-large'"
fi
echo ""
echo -e "  ${BOLD}Next steps:${NC}"
echo -e "  ${DIM}1.${NC} Install Node dependencies:    ${CYAN}npm install${NC}"
echo -e "  ${DIM}2.${NC} Start the scraper service:    ${CYAN}cd services/scraper && npm run dev${NC}"
echo ""
