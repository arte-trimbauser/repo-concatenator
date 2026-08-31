import fetch from 'node-fetch';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const { files, owner, repo, branch, token, commitMessage } = req.body;

  if (!files || !Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'Nenhum ficheiro para aplicar' });
  }
  if (!owner || !repo) {
    return res.status(400).json({ error: 'Dono e repositório são obrigatórios' });
  }

  const finalToken = token || GITHUB_TOKEN;
  const finalBranch = branch || 'main';
  const message = commitMessage || 'Aplicação de proposta via AI';

  if (!finalToken) {
    return res.status(400).json({ error: 'Token do GitHub necessário' });
  }

  try {
    const results = [];
    for (const file of files) {
      const result = await uploadFileToGitHub(
        owner, repo, finalBranch, finalToken,
        file.path, file.newContent, message
      );
      results.push({ path: file.path, success: result.success, message: result.message });
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.length - successCount;

    // Disparar deploy hook se configurado
    if (process.env.VERCEL_DEPLOY_HOOK && successCount > 0) {
      try {
        await fetch(process.env.VERCEL_DEPLOY_HOOK, { method: 'POST' });
      } catch (e) {
        console.warn('Deploy hook falhou:', e.message);
      }
    }

    res.json({
      message: `${successCount} ficheiro(s) aplicado(s) com sucesso.${failCount > 0 ? ` ${failCount} falha(s).` : ''}`,
      details: results,
      deployed: !!process.env.VERCEL_DEPLOY_HOOK
    });

  } catch (error) {
    console.error('Erro ao aplicar:', error);
    res.status(500).json({ error: 'Erro interno: ' + error.message });
  }
}

async function uploadFileToGitHub(owner, repo, branch, token, path, content, message) {
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
      return { success: false, message: `Erro ao obter SHA: ${getRes.status}` };
    }
  } catch (err) {
    return { success: false, message: `Erro de rede: ${err.message}` };
  }

  const encodedContent = Buffer.from(content, 'utf-8').toString('base64');
  const payload = {
    message: `${message}: ${path}`,
    content: encodedContent,
    branch: branch
  };
  if (sha) payload.sha = sha;

  try {
    const putRes = await fetch(url, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (putRes.ok) {
      return { success: true, message: 'Atualizado com sucesso' };
    } else {
      const errorData = await putRes.json();
      return { success: false, message: `Erro ${putRes.status}: ${errorData.message}` };
    }
  } catch (err) {
    return { success: false, message: `Erro de rede: ${err.message}` };
  }
}