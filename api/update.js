// api/update.js
import fetch from 'node-fetch';

// Variáveis de ambiente (fallback)
const ENV_TOKEN = process.env.GITHUB_TOKEN;
const ENV_OWNER = process.env.GITHUB_OWNER;
const ENV_REPO = process.env.GITHUB_REPO;
const ENV_BRANCH = process.env.GITHUB_BRANCH || 'main';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const { text, owner, repo, branch, token } = req.body;

  // Usa o que for fornecido, senão fallback para env
  const finalOwner = owner || ENV_OWNER;
  const finalRepo = repo || ENV_REPO;
  const finalBranch = branch || ENV_BRANCH;
  const finalToken = token || ENV_TOKEN;

  if (!text) {
    return res.status(400).json({ error: 'Texto não fornecido' });
  }
  if (!finalOwner || !finalRepo) {
    return res.status(400).json({ error: 'Dono e repositório são obrigatórios (forneça no formulário ou nas variáveis de ambiente).' });
  }
  if (!finalToken) {
    return res.status(400).json({ error: 'Token não fornecido (coloque no formulário ou na variável de ambiente GITHUB_TOKEN).' });
  }

  try {
    const files = parseFiles(text);
    if (files.length === 0) {
      return res.status(400).json({ error: 'Nenhum ficheiro encontrado no texto.' });
    }

    const results = [];
    for (const file of files) {
      const result = await uploadFileToGitHub(
        finalOwner,
        finalRepo,
        finalBranch,
        finalToken,
        file.path,
        file.content
      );
      results.push({ path: file.path, success: result.success, message: result.message });
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.length - successCount;
    res.status(200).json({
      message: `${successCount} ficheiro(s) atualizado(s) com sucesso.${failCount > 0 ? ` ${failCount} falha(s).` : ''}`,
      details: results
    });
  } catch (error) {
    console.error('Erro no servidor:', error);
    res.status(500).json({ error: 'Erro interno: ' + error.message });
  }
}

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

  // Obter SHA (se existir)
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
    message: `Atualização automática via repo-updater: ${path}`,
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
