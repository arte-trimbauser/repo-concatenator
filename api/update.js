import fetch from 'node-fetch';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const { text, owner, repo, branch = 'main', token } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'Nenhum conteúdo fornecido' });
  }
  if (!owner || !repo) {
    return res.status(400).json({ error: 'Dono e repositório são obrigatórios' });
  }

  const finalToken = token || GITHUB_TOKEN;

  if (!finalToken) {
    return res.status(400).json({ error: 'Token do GitHub necessário para atualização' });
  }

  try {
    const filesToUpdate = parseFiles(text);

    if (filesToUpdate.length === 0) {
      return res.status(400).json({
        error: 'Nenhum ficheiro válido encontrado no texto. Certifique-se de usar o formato "// ===== ARQUIVO: caminho/ficheiro.ext =====".'
      });
    }

    const results = [];
    for (const file of filesToUpdate) {
      const result = await uploadFileToGitHub(
        owner, repo, branch, finalToken,
        file.path, file.content
      );
      results.push({ path: file.path, success: result.success, message: result.message });
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
      message: `${successCount} ficheiro(s) atualizado(s) com sucesso.${failCount > 0 ? ` ${failCount} falha(s).` : ''}`,
      details: results
    });

  } catch (error) {
    console.error('Erro no envio manual:', error);
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
    message: `Atualização via Repo Concatenator: ${path}`,
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