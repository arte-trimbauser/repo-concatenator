import { GoogleGenerativeAI } from '@google/generative-ai';
import fetch from 'node-fetch';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const IGNORED_PATHS = [
  'package-lock.json', 'yarn.lock', 'node_modules/', '.git/', 
  'dist/', 'build/', '.next/', '.cache/'
];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const { repoUrl, question, owner, repo, branch, token } = req.body;

  if (!repoUrl) {
    return res.status(400).json({ error: 'URL do GitHub é obrigatória' });
  }
  if (!question) {
    return res.status(400).json({ error: 'A pergunta é obrigatória' });
  }

  const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)(?:\/tree\/([^\/]+)(?:\/(.+))?)?/);
  if (!match) {
    return res.status(400).json({ error: 'URL inválida' });
  }

  const finalOwner = owner || match[1];
  const finalRepo = repo || match[2];
  const finalBranch = branch || match[3] || 'main';
  const finalToken = token || GITHUB_TOKEN;

  if (!finalToken) {
    return res.status(400).json({ error: 'Token necessário' });
  }
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY não configurada' });
  }

  try {
    // Buscar árvore do repositório
    const treeRes = await fetch(
      `https://api.github.com/repos/${finalOwner}/${finalRepo}/git/trees/${finalBranch}?recursive=1`,
      { headers: { Authorization: `token ${finalToken}` } }
    );
    if (!treeRes.ok) throw new Error(`Erro GitHub: ${treeRes.status}`);
    const treeData = await treeRes.json();

    // Selecionar ficheiros relevantes (limite de 30 para chat)
    const files = treeData.tree
      .filter(f => {
        if (f.type !== 'blob') return false;
        if (IGNORED_PATHS.some(p => f.path.includes(p))) return false;
        return /\.(js|html|css|json|md|py|ts|jsx|tsx|txt|yml|yaml|sql)$/i.test(f.path);
      })
      .slice(0, 30);

    let context = '';
    for (const file of files) {
      const rawUrl = `https://raw.githubusercontent.com/${finalOwner}/${finalRepo}/${finalBranch}/${file.path}`;
      const contentRes = await fetch(rawUrl);
      if (contentRes.ok) {
        const content = await contentRes.text();
        context += `\n// ===== ${file.path} =====\n${content.substring(0, 3000)}\n`;
      }
    }

    const systemPrompt = `
Tu és um assistente de programação especializado em análise de código.
O utilizador vai fazer perguntas sobre o projeto dele.
Responde de forma clara, didática e útil.
NUNCA alteres código a menos que o utilizador peça explicitamente.
Se vires problemas, sugere melhorias mas de forma educada.
`;

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\nContexto do projeto (${files.length} ficheiros):\n${context}\n\nPergunta do utilizador: ${question}` }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 4096 }
    });

    const answer = result.response.text();

    res.json({ 
      answer, 
      filesAnalyzed: files.length,
      model: 'gemini-1.5-flash'
    });

  } catch (error) {
    console.error('Erro no chat:', error);
    res.status(500).json({ error: 'Erro interno: ' + error.message });
  }
}