#!/usr/bin/env bash
# Baixa o llama.cpp (Linux x64, Vulkan com fallback CPU) e instala em binaries/llama.
# Uso: bash scripts/fetch-llama.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LLAMA_DIR="$ROOT/src-tauri/binaries/llama"
mkdir -p "$LLAMA_DIR"

if [ -f "$LLAMA_DIR/llama-server" ]; then
  echo "llama runtime já existe em $LLAMA_DIR"
  exit 0
fi

echo "Buscando release mais recente do llama.cpp..."
API=$(curl -fsSL https://api.github.com/repos/ggml-org/llama.cpp/releases/latest)
URL=$(echo "$API" | grep browser_download_url | grep -E 'ubuntu-vulkan-x64\.zip' | head -1 | cut -d'"' -f4)
[ -z "$URL" ] && URL=$(echo "$API" | grep browser_download_url | grep -E 'ubuntu-x64\.zip' | head -1 | cut -d'"' -f4)
[ -z "$URL" ] && { echo "asset ubuntu-x64 não encontrado"; exit 1; }

echo "Baixando $URL"
curl -fsSL "$URL" -o /tmp/llama.zip
rm -rf /tmp/llama-extract
unzip -o -q /tmp/llama.zip -d /tmp/llama-extract
SRV=$(find /tmp/llama-extract -type f -name 'llama-server' | head -1)
[ -z "$SRV" ] && { echo "llama-server não encontrado no zip"; exit 1; }
cp -r "$(dirname "$SRV")"/* "$LLAMA_DIR"/
chmod +x "$LLAMA_DIR/llama-server" || true
rm -rf /tmp/llama.zip /tmp/llama-extract
echo "Instalado em $LLAMA_DIR"
