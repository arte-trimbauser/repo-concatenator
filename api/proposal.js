// api/proposal.js
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getRepoTree, getFileContent } from '../utils/github.js';
import { parseFiles } from '../utils/parser.js';
import { runSafetyChecks } from '../utils/safety.js';
import { AI_DEFAULTS, MAX_CONTEXT_CHARS } from '../utils/config.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const cache = new Map();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const { repoUrl, prompt, owner, repo, branch, model, temperature, maxTokens, dryRun = false } = req.body;
  if (!repoUrl || !prompt) return res.status(400).json({ error: 'URL e instrução são obrigatórios' });

  const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)(?:\/tree\/([^\/]+)(?:\/(.+))?)?/);
  if (!match) return res.status(400).json({ error: 'URL inválida' });

  const finalOwner = owner || match[1];
  const finalRepo = repo || match[2];
  const finalBranch = branch || match[3] || 'main';
  const finalToken = GITHUB_TOKEN;
  if (!finalToken) return res.status(500).json({ error: 'Token do GitHub não configurado' });
  if (!GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY não configurada' });

  const cacheKey = `${finalOwner}/${finalRepo}/${finalBranch}:${prompt.substring(0, 100)}`;
  const cached = cache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < 300000)) {
    return res.json(cached.data);
  }

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
    const modelName = model || AI_DEFAULTS.model;
    const genModel = genAI.getGenerativeModel({ model: modelName });
    const result = await genModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + userPrompt }] }],
      generationConfig: {
        temperature: temperature || AI_DEFAULTS.temperature,
        maxOutputTokens: maxTokens || AI_DEFAULTS.maxOutputTokens
      }
    });

    const aiOutput = result.response.text();
    if (!aiOutput) throw new Error('A IA não devolveu conteúdo');

    const parsedFiles = parseFiles(aiOutput);
    if (parsedFiles.length === 0) {
      return res.status(400).json({ error: 'A IA não incluiu cabeçalhos corretos.', aiOutput });
    }

    // Import dinâmico para pacotes CommonJS
    const { createTwoFilesPatch } = await import('diff');
    const { v4: uuidv4 } = await import('uuid');

    const filesWithDiff = parsedFiles.map(newFile => {
      const oldFile = fileContents.find(f => f.path === newFile.path);
      const oldContent = oldFile ? oldFile.content : '';
      const diffPatch = createTwoFilesPatch(
        newFile.path, newFile.path,
        oldContent, newFile.content,
        'original', 'modificado'
      );
      return {
        path: newFile.path,
        oldContent,
        newContent: newFile.content,
        diff: diffPatch,
        isNew: !oldFile
      };
    });

    const safety = runSafetyChecks(
      filesWithDiff.map(f => ({ path: f.path, newContent: f.newContent })),
      fileContents.map(f => f.path)
    );

    const proposalId = uuidv4();
    const responseData = {
      proposalId,
      objective: prompt,
      model: modelName,
      files: filesWithDiff,
      newFiles: filesWithDiff.filter(f => f.isNew).map(f => f.path),
      modifiedFiles: filesWithDiff.filter(f => !f.isNew).map(f => f.path),
      safety,
      aiOutput,
      summary: {
        totalFiles: filesWithDiff.length,
        newFiles: filesWithDiff.filter(f => f.isNew).length,
        modifiedFiles: filesWithDiff.filter(f => !f.isNew).length,
        hasErrors: safety.errors.length > 0,
        hasWarnings: safety.warnings.length > 0
      }
    };

    cache.set(cacheKey, { timestamp: Date.now(), data: responseData });
    res.json(responseData);

  } catch (error) {
    console.error('Erro na proposta:', error);
    res.status(500).json({ error: 'Erro interno: ' + error.message });
  }
}
