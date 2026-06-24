<div align="center">
  <img src="src-tauri/icons/128x128.png" alt="LocalSheets" width="96" />

  # LocalSheets

  **Planilha 100% offline, com IA local (GGUF) que edita as células de verdade.**
</div>

---

LocalSheets é o app irmão do [LocalOffice (Writer)](https://github.com/Anon5T4R/LocalOffice):
uma planilha estilo Excel, totalmente offline, em que a **IA local não só conversa — ela
preenche, calcula e edita células** para você.

## ✨ Recursos

- **Planilha estilo Excel** (jspreadsheet): fórmulas, formatação, múltiplas abas, copiar/colar.
- **IA local que edita células**: peça "preencha a coluna B com o dobro de A" ou "some a coluna A em A10"
  e a IA aplica as edições (inclusive fórmulas) direto na planilha.
- **Formatos**: **XLSX** e **CSV** (via SheetJS).
- **GGUF via llama.cpp** (build Vulkan, fallback CPU). Tudo em `127.0.0.1`, **zero telemetria**.
- Abrir-com-arquivo (associa .csv/.xlsx), confirmar ao fechar com alterações.

## 🧱 Stack

- **Tauri 2** (Rust) · **React + TS + Vite**
- **jspreadsheet-ce** (MIT) — grade de planilha
- **SheetJS / xlsx** (Apache-2.0) — leitura/escrita de arquivos
- **llama.cpp** (`llama-server`, sidecar) — IA local

## 🚀 Desenvolvimento

```bash
npm install
# baixar o runtime de IA (não versionado, ~90MB):
powershell -ExecutionPolicy Bypass -File scripts/fetch-llama.ps1   # Windows
bash scripts/fetch-llama.sh                                        # Linux
npm run tauri dev
```

Gerar instalável: `npm run tauri build`.

## 🤖 Usando a IA

1. Abra **✦ IA**, ajuste a pasta de modelos `.gguf`, escaneie e escolha um modelo, clique **Iniciar**.
2. Peça uma edição em linguagem natural. A IA enxerga a planilha (notação A1) e devolve as edições, que o app aplica.

## 📄 Licença

Código **MIT** (veja [LICENSE](LICENSE)). Binário de terceiros embarcado:
[llama.cpp](https://github.com/ggml-org/llama.cpp) (MIT).
