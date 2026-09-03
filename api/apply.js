import { uploadFileToGitHub } from '../utils/github.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const { files, owner, repo, branch, commitMessage, token } = req.body;
  if (!files || !Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'Nenhum ficheiro para aplicar' });
  }
  if (!owner || !repo) {
    return res.status(400).json({ error: 'Dono e repositório são obrigatórios' });
  }

  const finalToken = token || process.env.GITHUB_TOKEN;
  if (!finalToken) {
    return res.status(500).json({ error: 'Token do GitHub não configurado' });
  }

  const finalBranch = branch || 'main';
  const message = commitMessage || 'Aplicação de proposta via IA';

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

    if (process.env.VERCEL_DEPLOY_HOOK && successCount > 0) {
      try {
        await fetch(process.env.VERCEL_DEPLOY_HOOK, { method: 'POST' });
      } catch (e) {
        console.warn('Deploy hook falhou:', e.message);
      }
    }

    res.json({
      message: `${successCount} ficheiro(s) aplicado(s).${failCount ? ` ${failCount} falha(s).` : ''}`,
      details: results
    });
  } catch (error) {
    console.error('Erro em apply:', error);
    res.status(500).json({ error: 'Erro interno: ' + error.message });
  }
}
