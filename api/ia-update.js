// api/ia-update.js
import fetch from 'node-fetch';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const { repoUrl, prompt, owner, repo, branch, token } = req.body;

  const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)(?:\/tree\/([^\/]+))?/);
  if (!match) {
    return res.status(400).json({ error: 'URL do GitHub inválida' });
  }

  const finalOwner = owner || match[1];
  const finalRepo = repo || match[2];
  const finalBranch = branch || match[3] || 'main';
  const finalToken = token || GITHUB_TOKEN;

  if (!finalToken) {
    return res.status(400).json({ error: 'Token do GitHub necessário' });
  }
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY não configurada' });
  }

  try {
    // 1. Buscar árvore do repositório
    const treeRes = await fetch(
      `https://api.github.com/repos/${finalOwner}/${finalRepo}/git/trees/${finalBranch}?recursive=1`,
      { headers: { Authorization: `token ${finalToken}` } }
    );
    if (!treeRes.ok) {
      throw new Error(`GitHub API error: ${treeRes.status}`);
    }
    const treeData = await treeRes.json();

    // 2. Obter conteúdo dos ficheiros
    const files = treeData.tree
      .filter(f => f.type === 'blob' && /\.(js|html|css|json|md|py|sh|ts|jsx|tsx|txt|yml|yaml|xml|sql)$/i.test(f.path))
      .slice(0, 30);

    let context = '';
    for (const file of files) {
      const rawUrl = `https://raw.githubusercontent.com/${finalOwner}/${finalRepo}/${finalBranch}/${file.path}`;
      const contentRes = await fetch(rawUrl);
      if (contentRes.ok) {
        const content = await contentRes.text();
        context += `\n// ===== ARQUIVO: ${file.path} =====\n\n${content}\n`;
      }
    }

    // 3. Montar prompt
    const systemPrompt = `
Tu és um assistente de código que modifica ficheiros de um repositório GitHub.
Recebes uma lista de ficheiros com o formato:
// ===== ARQUIVO: caminho/ficheiro.ext =====
conteúdo do ficheiro

O utilizador vai dar uma instrução. Deves:
- Modificar os ficheiros existentes conforme necessário.
- Criar novos ficheiros se for pedido.
- Responder APENAS com o texto no formato acima (com os cabeçalhos // ===== ARQUIVO: ...).
- Não adicionar texto extra, apenas os ficheiros modificados.
- Mantém a estrutura exata dos ficheiros que não mudaram.
`;

    const userPrompt = `Instrução: ${prompt}\n\nContexto do repositório:\n${context}`;

    // 4. Chamar Gemini com gemini-pro (estável e gratuito)
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: systemPrompt + '\n\n' + userPrompt }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 8192
          }
        })
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      throw new Error(`Gemini API error: ${geminiRes.status} - ${errText}`);
    }

    const geminiData = await geminiRes.json();
    const aiOutput = geminiData.candidates[0]?.content?.parts[0]?.text || '';

    if (!aiOutput) {
      throw new Error('A IA não devolveu conteúdo.');
    }

    // 5. Parse do output da IA
    const filesToUpdate = parseFiles(aiOutput);

    if (filesToUpdate.length === 0) {
      return res.status(400).json({
        error: 'A IA não gerou ficheiros válidos. Resposta da IA:\n' + aiOutput.substring(0, 500)
      });
    }

    // 6. Enviar para o GitHub
    const results = [];
    for (const file of filesToUpdate) {
      const result = await uploadFileToGitHub(
        finalOwner, finalRepo, finalBranch, finalToken,
        file.path, file.content
      );
      results.push({ path: file.path, success: result.success, message: result.message });
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.length - successCount;

    // 7. (Opcional) Trigger deploy na Vercel
    if (process.env.VERCEL_DEPLOY_HOOK) {
      try {
        await fetch(process.env.VERCEL_DEPLOY_HOOK, { method: 'POST' });
      } catch (e) {
        console.warn('Deploy hook falhou:', e.message);
      }
    }

    res.json({
      message: `${successCount} ficheiro(s) atualizado(s) com IA.${failCount > 0 ? ` ${failCount} falha(s).` : ''}`,
      details: results,
      aiOutput: aiOutput.substring(0, 1000)
    });

  } catch (error) {
    console.error('Erro no IA update:', error);
    res.status(500).json({ error: 'Erro interno: ' + error.message });
  }
}

// ===== FUNÇÕES AUXILIARES =====

function parseFiles(text) {
  const files = [];
  const regex = /\/\/\s*={5,}\s*ARQUIVO:\s*([^\n]+?)\s*={5,}\s*\n\n([\s\S]*?)(?=\n\n\/\/\s*={5,}\s*ARQUIVO:|$)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const path = match[1].trim();
    let content = match[2];
    content = content.replace(/^\n+/, '').replace(/\n+$/, '');
    if (path && content) {
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
