import { GoogleGenerativeAI } from '@google/generative-ai';
import fetch from 'node-fetch';
import { createTwoFilesPatch } from 'diff';
import { v4 as uuidv4 } from 'uuid';
import { runSafetyChecks } from '../utils/safety.js';

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

  const { repoUrl, prompt, owner, repo, branch, token, maxFiles = 50 } = req.body;

  if (!repoUrl || !prompt) {
    return res.status(400).json({ error: 'URL e instrução são obrigatórios' });
  }

  const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)(?:\/tree\/([^\/]+)(?:\/(.+))?)?/);
  if (!match) return res.status(400).json({ error: 'URL inválida' });

  const finalOwner = owner || match[1];
  const finalRepo = repo || match[2];
  const finalBranch = branch || match[3] || 'main';
  const finalToken = token || GITHUB_TOKEN;

  if (!finalToken) return res.status(400).json({ error: 'Token necessário' });
  if (!GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY não configurada' });

  try {
    // 1. Buscar árvore do repositório
    const treeRes = await fetch(
      `https://api.github.com/repos/${finalOwner}/${finalRepo}/git/trees/${finalBranch}?recursive=1`,
      { headers: { Authorization: `token ${finalToken}` } }
    );
    if (!treeRes.ok) throw new Error(`Erro GitHub: ${treeRes.status}`);
    const treeData = await treeRes.json();

    const fileLimit = Math.min(Math.max(parseInt(maxFiles, 10) || 50, 10), 100);

    const files = treeData.tree
      .filter(f => {
        if (f.type !== 'blob') return false;
        if (IGNORED_PATHS.some(p => f.path.includes(p))) return false;
        return /\.(js|html|css|json|md|py|sh|ts|jsx|tsx|txt|yml|yaml|xml|sql)$/i.test(f.path);
      })
      .slice(0, fileLimit);

    // 2. Baixar conteúdo de cada ficheiro
    const fileContents = [];
    for (const file of files) {
      const rawUrl = `https://raw.githubusercontent.com/${finalOwner}/${finalRepo}/${finalBranch}/${file.path}`;
      const contentRes = await fetch(rawUrl);
      if (contentRes.ok) {
        const content = await contentRes.text();
        fileContents.push({ path: file.path, content });
      }
    }

    let context = fileContents.map(f => `// ===== ${f.path} =====\n${f.content}`).join('\n\n');

    // 3. Chamar a IA para gerar as alterações
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
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + userPrompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 8192 }
    });

    const aiOutput = result.response.text();
    if (!aiOutput) throw new Error('A IA não devolveu conteúdo');

    // 4. Parse dos ficheiros gerados
    const parsedFiles = parseFiles(aiOutput);
    if (parsedFiles.length === 0) {
      return res.status(400).json({ 
        error: 'A IA não incluiu cabeçalhos corretos.',
        aiOutput 
      });
    }

    // 5. Gerar diff para cada ficheiro
    const filesWithDiff = parsedFiles.map(newFile => {
      const oldFile = fileContents.find(f => f.path === newFile.path);
      const oldContent = oldFile ? oldFile.content : '';
      
      const diffPatch = createTwoFilesPatch(
        newFile.path,
        newFile.path,
        oldContent,
        newFile.content,
        'original',
        'modificado'
      );

      return {
        path: newFile.path,
        oldContent,
        newContent: newFile.content,
        diff: diffPatch,
        isNew: !oldFile
      };
    });

    // 6. Executar Safety Checks
    const safetyResults = await runSafetyChecks(
      filesWithDiff.map(f => ({ path: f.path, newContent: f.newContent })),
      fileContents.map(f => f.path)
    );

    // 7. Gerar ID da proposta
    const proposalId = uuidv4();

    // 8. Devolver a proposta (sem commit!)
    res.json({
      proposalId,
      objective: prompt,
      model: 'gemini-1.5-pro',
      files: filesWithDiff,
      newFiles: filesWithDiff.filter(f => f.isNew).map(f => f.path),
      modifiedFiles: filesWithDiff.filter(f => !f.isNew).map(f => f.path),
      safety: safetyResults,
      aiOutput,
      summary: {
        totalFiles: filesWithDiff.length,
        newFiles: filesWithDiff.filter(f => f.isNew).length,
        modifiedFiles: filesWithDiff.filter(f => !f.isNew).length,
        hasErrors: safetyResults.errors.length > 0,
        hasWarnings: safetyResults.warnings.length > 0
      }
    });

  } catch (error) {
    console.error('Erro na proposta:', error);
    res.status(500).json({ error: 'Erro interno: ' + error.message });
  }
}

function parseFiles(text) {
  const files = [];
  const normalizedText = text.replace(/\r\n/g, '\n');
  const regex = /(?:\/\/\s*|#\s*|\/\*\s*)?={3,}\s*ARQUIVO:\s*([^\n]+?)\s*={3,}(?:\s*\*\/)?\n+([\s\S]*?)(?=(?:\n(?:\/\/\s*|#\s*|\/\*\s*)?={3,}\s*ARQUIVO:|$))/gi;
  let match;
  while ((match = regex.exec(normalizedText)) !== null) {
    const path = match[1].trim();
    let content = match[2];
    content = content.replace(/^\n+/, '').replace(/\n+$/, '');
    if (path) files.push({ path, content });
  }
  return files;
}