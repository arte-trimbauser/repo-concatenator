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

  // Arquivos/pastas a ignorar (opcional)
  const ignore = [
    'package-lock.json', 'yarn.lock', '.gitignore', '.env',
    'node_modules/', '.git/', 'dist/', 'build/', '.next/', '.cache/'
  ];

  try {
    const treeRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
      { headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` } }
    );
    if (!treeRes.ok) throw new Error(`GitHub error: ${treeRes.status}`);
    const treeData = await treeRes.json();

    const files = treeData.tree
      .filter(item => item.type === 'blob')
      .filter(item => !ignore.some(p => item.path.includes(p) || item.path.endsWith('.min.js') || item.path.endsWith('.min.css')))
      .sort((a, b) => a.path.localeCompare(b.path));

    let fullContent = `# Conteúdo completo do repositório ${owner}/${repo}\n`;
    fullContent += `# Branch: ${branch}\n`;
    fullContent += `# Total de arquivos: ${files.length}\n\n`;

    for (const file of files) {
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file.path}`;
      const contentRes = await fetch(rawUrl, {
        headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` }
      });
      if (contentRes.ok) {
        let content = await contentRes.text();
        if (content.length > 500000) {
          content = content.substring(0, 500000) + '\n... (arquivo truncado)';
        }
        fullContent += `\n// ===== ${file.path} =====\n${content}\n`;
      } else {
        fullContent += `\n// ===== ${file.path} =====\n// Erro ao baixar: ${contentRes.status}\n`;
      }
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${repo}-concatenado.txt"`);
    res.status(200).send(fullContent);
  } catch (error) {
    console.error('Erro no download:', error);
    res.status(500).json({ error: error.message });
  }
}
