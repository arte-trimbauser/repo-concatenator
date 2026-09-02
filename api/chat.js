// api/chat.js
import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const IGNORED_PATHS = [
  'package-lock.json', 'yarn.lock', 'node_modules/', '.git/',
  'dist/', 'build/', '.next/', '.cache/'
];

export default async function handler(req, res) {
  // 1. Apenas POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const { repoUrl, question, owner, repo, branch } = req.body;

  // 2. Validação básica
  if (!repoUrl || !question) {
    return res.status(400).json({ error: 'URL e pergunta são obrigatórios' });
  }

  // 3. Verificar variáveis de ambiente
  if (!GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY não definida');
    return res.status(500).json({ error: 'GEMINI_API_KEY não configurada' });
  }
  if (!GITHUB_TOKEN) {
    console.error('GITHUB_TOKEN não definido');
    return res.status(500).json({ error: 'GITHUB_TOKEN não configurado' });
  }

  // 4. Extrair owner/repo/branch da URL
  const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)(?:\/tree\/([^\/]+)(?:\/(.+))?)?/);
  if (!match) {
    return res.status(400).json({ error: 'URL inválida. Use o formato: https://github.com/usuario/repo/tree/branch' });
  }

  const finalOwner = owner || match[1];
  const finalRepo = repo || match[2];
  const finalBranch = branch || match[3] || 'main';

  try {
    // 5. Buscar árvore de ficheiros
    const treeRes = await fetch(
      `https://api.github.com/repos/${finalOwner}/${finalRepo}/git/trees/${finalBranch}?recursive=1`,
      { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
    );
    if (!treeRes.ok) {
      throw new Error(`Erro GitHub: ${treeRes.status} ${await treeRes.text()}`);
    }
    const treeData = await treeRes.json();

    // 6. Filtrar ficheiros de código
    const files = treeData.tree
      .filter(item => {
        if (item.type !== 'blob') return false;
        if (IGNORED_PATHS.some(p => item.path.includes(p) || item.path.endsWith('.min.js') || item.path.endsWith('.min.css'))) {
          return false;
        }
        return /\.(js|html|css|json|md|py|ts|jsx|tsx|txt|yml|yaml|sql|env\.example)$/i.test(item.path);
      })
      .slice(0, 30); // limite para não sobrecarregar

    // 7. Obter conteúdo de cada ficheiro
    let context = '';
    let count = 0;
    for (const file of files) {
      const rawUrl = `https://raw.githubusercontent.com/${finalOwner}/${finalRepo}/${finalBranch}/${file.path}`;
      const contentRes = await fetch(rawUrl, {
        headers: { Authorization: `token ${GITHUB_TOKEN}` }
      });
      if (contentRes.ok) {
        const content = await contentRes.text();
        const truncated = content.length > 30000 ? content.substring(0, 30000) + '...' : content;
        context += `\n// ===== ${file.path} =====\n${truncated}\n`;
        count++;
      }
    }

    if (!context) {
      return res.status(404).json({ error: 'Nenhum ficheiro de código encontrado.' });
    }

    // 8. Chamar Gemini
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
    
    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [{ text: `Contexto do projeto (${count} ficheiros):\n${context}\n\nPergunta: ${question}` }]
        }
      ],
      generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
    });

    const answer = result.response.text();

    // 9. Resposta de sucesso
    res.json({ answer, filesAnalyzed: count, model: 'gemini-1.5-flash' });

  } catch (error) {
    console.error('Erro no chat:', error);
    res.status(500).json({ error: 'Erro interno: ' + error.message });
  }
}
