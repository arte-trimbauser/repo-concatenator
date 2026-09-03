import { getFileContent } from '../utils/github.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const { owner, repo, branch, path, token } = req.body;
  if (!owner || !repo || !path) {
    return res.status(400).json({ error: 'Parâmetros insuficientes' });
  }

  const finalToken = token || process.env.GITHUB_TOKEN;
  if (!finalToken) {
    return res.status(500).json({ error: 'Token não configurado' });
  }

  try {
    const content = await getFileContent(owner, repo, branch, path, finalToken);
    if (content === null) {
      return res.status(404).json({ error: 'Ficheiro não encontrado' });
    }
    res.json({ content });
  } catch (err) {
    console.error('Erro em get-content:', err);
    res.status(500).json({ error: err.message });
  }
}
