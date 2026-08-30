// api/update.js
import fetch from 'node-fetch';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'Texto não fornecido' });
  }

  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    console.error('Variáveis de ambiente faltando:', { GITHUB_TOKEN: !!GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO });
    return res.status(500).json({ error: 'Configuração do servidor incompleta' });
  }

  try {
    const files = parseFiles(text);
    if (files.length === 0) {
      return res.status(400).json({ error: 'Nenhum ficheiro encontrado no texto.' });
    }

    const results = [];
    for (const file of files) {
      const result = await uploadFileToGitHub(file.path, file.content);
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

async function uploadFileToGitHub(path, content) {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;

  let sha = null;
  try {
    const getRes = await fetch(url, {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json'
      }
    });
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
    branch: GITHUB_BRANCH
  };
  if (sha) payload.sha = sha;

  try {
    const putRes = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
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
