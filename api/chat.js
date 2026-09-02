// api/chat.js
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getRepoTree, getFileContent } from '../utils/github.js';
import { AI_DEFAULTS, MAX_CONTEXT_CHARS } from '../utils/config.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const { repoUrl, question, owner, repo, branch } = req.body;
  if (!repoUrl || !question) {
    return res.status(400).json({ error: 'URL e pergunta são obrigatórios' });
  }

  const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)(?:\/tree\/([^\/]+)(?:\/(.+))?)?/);
  if (!match) return res.status(400).json({ error: 'URL inválida' });

  const finalOwner = owner || match[1];
  const finalRepo = repo || match[2];
  const finalBranch = branch || match[3] || 'main';
  const finalToken = GITHUB_TOKEN;
  if (!finalToken) return res.status(500).json({ error: 'Token do GitHub não configurado' });
  if (!GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY não configurada' });

  try {
    const files = await getRepoTree(finalOwner, finalRepo, finalBranch, finalToken);
    let context = '';
    for (const file of files) {
      const content = await getFileContent(finalOwner, finalRepo, finalBranch, file.path, finalToken);
      if (content) {
        // Limitar caracteres por ficheiro para não estourar o contexto
        const truncated = content.length > MAX_CONTEXT_CHARS ? content.substring(0, MAX_CONTEXT_CHARS) + '...' : content;
        context += `\n// ===== ${file.path} =====\n${truncated}\n`;
      }
    }

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: AI_DEFAULTS.model });
    const result = await model.generateContent({
      contents: [
        { role: 'user', parts: [{ text: `Contexto do projeto (${files.length} ficheiros):\n${context}\n\nPergunta: ${question}` }] }
      ],
      generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
    });

    res.json({ answer: result.response.text(), filesAnalyzed: files.length });

  } catch (error) {
    console.error('Erro no chat:', error);
    res.status(500).json({ error: 'Erro interno: ' + error.message });
  }
}
