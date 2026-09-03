import { getRepoTree } from '../utils/github.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const { repoUrl, branch, extensions, token } = req.body;
  if (!repoUrl) {
    return res.status(400).json({ error: 'URL do repositório é obrigatória' });
  }

  const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)(?:\/tree\/([^\/]+))?(?:\/(.*))?/);
  if (!match) {
    return res.status(400).json({ error: 'URL inválida' });
  }

  const owner = match[1];
  const repo = match[2];
  const finalBranch = branch || match[3] || 'main';
  const finalToken = token || process.env.GITHUB_TOKEN;
  if (!finalToken) {
    return res.status(500).json({ error: 'Token do GitHub não configurado' });
  }

  try {
    const files = await getRepoTree(owner, repo, finalBranch, finalToken);
    // Aplica filtro de extensões se fornecido
    let filtered = files;
    if (extensions && extensions.length > 0) {
      filtered = files.filter(f => extensions.some(ext => f.path.endsWith(ext)));
    }
    // Devolver no formato esperado: array com path, sha, size
    const result = filtered.map(f => ({ path: f.path, sha: f.sha, size: f.size }));
    res.json({ files: result, total: result.length });
  } catch (error) {
    console.error('Erro em list:', error);
    res.status(500).json({ error: error.message });
  }
}
