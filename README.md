# Repo Concatenator

Ferramenta web para concatenar ficheiros de repositórios GitHub e aplicar alterações via IA (Google Gemini).

## 🚀 Funcionalidades

- **Download (Concatenar):** Busca e concatena ficheiros de código de qualquer repositório público.
- **Upload (Atualizar):** Envia ficheiros formatados com cabeçalhos `// ===== ARQUIVO: caminho =====` para o GitHub.
- **IA com Proposta:** Gera propostas de alteração usando Gemini, com pré-visualização de diff e safety checks.
- **Modo Dry Run:** Teste sem commit (apenas preview).
- **Dark Mode** e interface responsiva.

## ⚙️ Configuração

Variáveis de ambiente (na Vercel):

- `GEMINI_API_KEY` – Chave da API Google Gemini.
- `GITHUB_TOKEN` – Personal Access Token com permissões `repo` (ou `contents:write`).
- `VERCEL_DEPLOY_HOOK` (opcional) – URL para re-deploy automático.

## 🛠️ Tecnologias

- Frontend: HTML5, CSS3, JavaScript Vanilla.
- Backend: Vercel Serverless Functions (Node.js).
- IA: Google Gemini (`@google/generative-ai`).
- GitHub REST API.

## 📦 Desenvolvimento

```bash
npm install
# Executar localmente com Vercel CLI:
vercel dev
