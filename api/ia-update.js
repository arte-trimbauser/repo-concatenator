// api/ia-update.js
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getRepoTree, getFileContent, uploadFileToGitHub } from '../utils/github.js';
import { parseFiles } from '../utils/parser.js';
import { AI_DEFAULTS, MAX_CONTEXT_CHARS } from '../utils/config.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const { repoUrl, prompt, owner, repo, branch, dryRun = false } = req.body;
  if (!repoUrl || !prompt) {
    return res.status(400).json({ error: 'URL e instrução são obrigatórios' });
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
    const fileContents = [];
    for (const file of files) {
      const content = await getFileContent(finalOwner, finalRepo, finalBranch, file.path, finalToken);
      if (content) {
        fileContents.push({ path: file.path, content: content.length > MAX_CONTEXT_CHARS ? content.substring(0, MAX_CONTEXT_CHARS) + '...' : content });
      }
    }

    const context = fileContents.map(f => `// ===== ${f.path} =====\n${f.content}`).join('\n\n');

    const systemPrompt = `
Tu és um assistente que modifica ficheiros num repositório GitHub.

REGRAS OBRIGATÓRIAS:
1. Para CADA ficheiro alterado ou criado, usa o cabeçalho exato: // ===== ARQUIVO: caminho/ficheiro.ext =====
2. Devolve APENAS os ficheiros modificados ou criados.
3. Escreve o conteúdo COMPLETO (não uses "...").
4. NÃO adiciones texto explicativo fora dos blocos.
5. A resposta deve ser 100% parseável.
`;

    const userPrompt = `Instrução: ${prompt}\n\nContexto (${fileContents.length} ficheiros):\n${context}`;

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: AI_DEFAULTS.model });
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + userPrompt }] }],
      generationConfig: { temperature: AI_DEFAULTS.temperature, maxOutputTokens: AI_DEFAULTS.maxOutputTokens }
    });

    const aiOutput = result.response.text();
    if (!aiOutput) throw new Error('A IA não devolveu conteúdo');

    const parsedFiles = parseFiles(aiOutput);
    if (parsedFiles.length === 0) {
      return res.status(400).json({ error: 'A IA não incluiu cabeçalhos corretos.', aiOutput });
    }

    if (dryRun) {
      return res.json({
        message: `Preview gerado (${parsedFiles.length} ficheiro(s)). Nenhuma alteração commitada.`,
        preview: true,
        files: parsedFiles,
        aiOutput
      });
    }

    // Commit
    const results = [];
    for (const file of parsedFiles) {
      const result = await uploadFileToGitHub(
        finalOwner, finalRepo, finalBranch, finalToken,
        file.path, file.content, `IA update: ${prompt.substring(0, 50)}`
      );
      results.push({ path: file.path, success: result.success, message: result.message });
    }

    const successCount = results.filter(r => r.success).length;
    if (process.env.VERCEL_DEPLOY_HOOK && successCount > 0) {
      try { await fetch(process.env.VERCEL_DEPLOY_HOOK, { method: 'POST' }); } catch (e) {}
    }

    res.json({
      message: `${successCount} ficheiro(s) atualizado(s).`,
      details: results,
      files: parsedFiles,
      aiOutput
    });

  } catch (error) {
    console.error('Erro em ia-update:', error);
    res.status(500).json({ error: 'Erro interno: ' + error.message });
  }
}
