export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const { repoUrl } = req.body;
  if (!repoUrl) {
    return res.status(400).json({ error: 'URL do repositório é obrigatória' });
  }

  const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)(?:\/tree\/([^\/]+)(?:\/(.+))?)?/);
  if (!match) {
    return res.status(400).json({ error: 'URL inválida' });
  }

  const owner = match[1];
  const repo = match[2];
  const branch = match[3] || 'main';

  try {
    const treeRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
      { headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` } }
    );
    if (!treeRes.ok) throw new Error(`GitHub error: ${treeRes.status}`);
    const treeData = await treeRes.json();

    const files = treeData.tree
      .filter(item => item.type === 'blob')
      .map(item => item.path)
      .sort();

    res.json({ files, total: files.length });
  } catch (error) {
    console.error('Erro ao listar arquivos:', error);
    res.status(500).json({ error: error.message });
  }
}
