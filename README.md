# repo-concatenator

Uma ferramenta web simples e eficiente para concatenar ficheiros de repositórios GitHub num único texto e atualizar/modificar repositórios usando a API do GitHub e a IA (Google Gemini).

## 🚀 Funcionalidades

- **📥 Download (Concatenar):** Baixa e junta ficheiros de código de qualquer repositório GitHub público ou ramo específico num único bloco de texto formatado.
- **📤 Upload (Atualizar Repo):** Lê blocos de código formatados com o padrão `// ===== ARQUIVO: caminho/ficheiro.ext =====` e atualiza/cria os ficheiros diretamente no GitHub.
- **🤖 Modo IA (com Gemini):** Permite dar instruções em linguagem natural para modificar o código do repositório automaticamente.

## ⚙️ Configuração das Variáveis de Ambiente

Cria ou configura na Vercel as seguintes variáveis:

- `GEMINI_API_KEY`: Chave da API do Google Gemini (obtida no Google AI Studio).
- `GITHUB_TOKEN`: Personal Access Token do GitHub com permissões de escrita em repositórios (`repo` ou `contents:write`).
- `VERCEL_DEPLOY_HOOK` (Opcional): URL de webhook para acionar re-deploy após atualização de ficheiros.

## 🛠️ Tecnologias

- Frontend: HTML5, CSS3 (com suporte a Dark Mode), JavaScript Vanilla.
- Backend: Vercel Serverless Functions (Node.js).
- Integrações: GitHub REST API, `@google/generative-ai`.