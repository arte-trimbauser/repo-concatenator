import { GoogleGenerativeAI } from '@google/generative-ai';
import fetch from 'node-fetch';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// Ficheiros e pastas a ignorar para não poluir o contexto
const IGNORED_PATHS = [
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb',
  'node_modules/', '.git/', 'dist/', 'build/', '.next/', '.cache/'
];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const { repoUrl, prompt, owner, repo, branch, token, dryRun = false, maxFiles = 50 } = req.body;

  if (!repoUrl) {
    return res.status(400).json({ error: 'URL do GitHub é obrigatória' });
  }

  const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)(?:\/tree\/([^\/]+)(?:\/(.+))?)?/);
  if (!match) {
    return res.status(400).json({ error: 'URL do GitHub inválida' });
  }

  const finalOwner = owner || match[1];
  const finalRepo = repo || match[2];
  const finalBranch = branch || match[3] || 'main';
  const basePath = match[4] ? match[4] + '/' : '';
  const finalToken = token || GITHUB_TOKEN;

  if (!finalToken) {
    return res.status(400).json({ error: 'Token do GitHub necessário para processar o repositório.' });
  }
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY não configurada no servidor.' });
  }

  try {
    const treeRes = await fetch(
      `https://api.github.com/repos/${finalOwner}/${finalRepo}/git/trees/${finalBranch}?recursive=1`,
      { headers: { Authorization: `token ${finalToken}` } }
    );
    if (!treeRes.ok) {
      throw new Error(`Erro na API do GitHub: status ${treeRes.status}`);
    }
    const treeData = await treeRes.json();

    const fileLimit = Math.min(Math.max(parseInt(maxFiles, 10) || 50, 10), 100);

    const files = treeData.tree
      .filter(f => {
        if (f.type !== 'blob') return false;
        if (basePath && !f.path.startsWith(basePath)) return false;
        if (IGNORED_PATHS.some(ignored => f.path.includes(ignored) || f.path.endsWith('.min.js') || f.path.endsWith('.min.css'))) {
          return false;
        }
        return /\.(js|html|css|json|md|py|sh|ts|jsx|tsx|txt|yml|yaml|xml|sql|env\.example)$/i.test(f.path);
      })
      .slice(0, fileLimit);

    let context = '';
    for (const file of files) {
      const rawUrl = `https://raw.githubusercontent.com/${finalOwner}/${finalRepo}/${finalBranch}/${file.path}`;
      const contentRes = await fetch(rawUrl);
      if (contentRes.ok) {
        const content = await contentRes.text();
        context += `\n// ===== ARQUIVO: ${file.path} =====\n\n${content}\n`;
      }
    }

    const systemPrompt = `
Tu és um assistente perito em engenharia de software que altera ficheiros num repositório GitHub.
A tua tarefa é analisar o código fornecido e gerar APENAS as alterações pedidas.

REGRAS OBRIGATÓRIAS:
1. Para CADA ficheiro alterado ou criado, DEVES obrigatoriamente incluir o cabeçalho no seguinte formato exato:
// ===== ARQUIVO: caminho/ficheiro.ext =====

2. NÃO omitas o cabeçalho "// ===== ARQUIVO: ...". Sem este cabeçalho exato, o sistema não conseguirá guardar as alterações!
3. Devolve APENAS os ficheiros que foram modificados ou criados. Não precisas de devolver ficheiros não alterados.
4. Escreve o conteúdo COMPLETO do ficheiro modificado (não uses reticências "..." para omitir código existente).
5. NÃO adicione texto explicativo fora dos blocos de ficheiro. A resposta deve ser 100% parseável.
`;

    const userPrompt = `Instrução: ${prompt}\n\nContexto dos ficheiros do repositório (${files.length} ficheiros analisados):\n${context}`;

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    
    let model;
    let modelName = 'gemini-1.5-flash';
  try {
  model = genAI.getGenerativeModel({ model: modelName });
} catch (err) {
  modelName = 'gemini-1.5-pro';
  model = genAI.getGenerativeModel({ model: modelName });
}

    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [{ text: systemPrompt + '\n\n' + userPrompt }]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 8192
      }
    });

    const aiOutput = result.response.text();

    if (!aiOutput) {
      throw new Error('A IA não devolveu qualquer conteúdo.');
    }

    const filesToUpdate = parseFiles(aiOutput);

    if (filesToUpdate.length === 0) {
      return res.status(400).json({
        error: 'A IA não incluiu os cabeçalhos de ficheiro corretos ("// ===== ARQUIVO: caminho/ficheiro.ext ====="). Revise a resposta bruta.',
        aiOutput: aiOutput
      });
    }

    // Se for modo Dry Run / Preview, não envia para o GitHub
    if (dryRun) {
      return res.json({
        message: `Preview gerado com sucesso (${filesToUpdate.length} ficheiro(s) alterado(s)). Nenhuma alteração foi commitada no GitHub.`,
        preview: true,
        details: filesToUpdate.map(f => ({ path: f.path, status: 'Preview / Aguarda Confirmação' })),
        files: filesToUpdate,
        aiOutput: aiOutput
      });
    }

    // Modo de commit direto
    const results = [];
    for (const file of filesToUpdate) {
      const uploadRes = await uploadFileToGitHub(
        finalOwner, finalRepo, finalBranch, finalToken,
        file.path, file.content
      );
      results.push({ path: file.path, success: uploadRes.success, message: uploadRes.message });
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.length - successCount;

    if (process.env.VERCEL_DEPLOY_HOOK && successCount > 0) {
      try {
        await fetch(process.env.VERCEL_DEPLOY_HOOK, { method: 'POST' });
      } catch (e) {
        console.warn('Deploy hook falhou:', e.message);
      }
    }

    res.json({
      message: `${successCount} ficheiro(s) atualizado(s) no GitHub com IA (modelo ${modelName}).${failCount > 0 ? ` ${failCount} falha(s).` : ''}`,
      details: results,
      files: filesToUpdate,
      aiOutput: aiOutput
    });

  } catch (error) {
    console.error('Erro no IA update:', error);
    res.status(500).json({ error: 'Erro interno: ' + error.message });
  }
}

function parseFiles(text) {
  const files = [];
  const normalizedText = text.replace(/\r\n/g, '\n');
  
  // Expressão regular flexível para apanhar variações de cabeçalho
  const regex = /(?:\/\/\s*|#\s*|\/\*\s*)?={3,}\s*ARQUIVO:\s*([^\n]+?)\s*={3,}(?:\s*\*\/)?\n+([\s\S]*?)(?=(?:\n(?:\/\/\s*|#\s*|\/\*\s*)?={3,}\s*ARQUIVO:|$))/gi;

  let match;
  while ((match = regex.exec(normalizedText)) !== null) {
    const path = match[1].trim();
    let content = match[2];
    content = content.replace(/^\n+/, '').replace(/\n+$/, '');
    if (path) {
      files.push({ path, content });
    }
  }
  return files;
}

async function uploadFileToGitHub(owner, repo, branch, token, path, content) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const headers = {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github.v3+json'
  };

  let sha = null;
  try {
    const getRes = await fetch(url, { headers });
    if (getRes.ok) {
      const data = await getRes.json();
      sha = data.sha;
    } else if (getRes.status !== 404) {
      const errorText = await getRes.text();
      return { success: false, message: `Erro ao obter SHA: ${getRes.status} - ${errorText}` };
    }
  } catch (err) {
    return { success: false, message: `Erro de rede ao obter SHA: ${err.message}` };
  }

  const encodedContent = Buffer.from(content, 'utf-8').toString('base64');
  const payload = {
    message: `Atualização IA via Gemini: ${path}`,
    content: encodedContent,
    branch: branch
  };
  if (sha) payload.sha = sha;

  try {
    const putRes = await fetch(url, {
      method: 'PUT',
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (putRes.ok) {
      return { success: true, message: 'Atualizado com sucesso' };
    } else {
      const errorData = await putRes.json();
      return { success: false, message: `Erro ${putRes.status}: ${errorData.message || 'Erro desconhecido'}` };
    }
  } catch (err) {
    return { success: false, message: `Erro de rede ao enviar: ${err.message}` };
  }
}
