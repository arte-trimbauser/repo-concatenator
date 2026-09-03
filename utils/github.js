import { IGNORED_PATHS, ALLOWED_EXTENSIONS, MAX_FILES } from './config.js';

export async function getRepoTree(owner, repo, branch, token, basePath = '') {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  const response = await fetch(url, {
    headers: { Authorization: `token ${token}` }
  });
  if (!response.ok) {
    throw new Error(`GitHub API error (${response.status}): ${await response.text()}`);
  }
  const data = await response.json();
  return data.tree
    .filter(item => {
      if (item.type !== 'blob') return false;
      if (basePath && !item.path.startsWith(basePath)) return false;
      if (IGNORED_PATHS.some(p => item.path.includes(p) || item.path.endsWith('.min.js') || item.path.endsWith('.min.css'))) {
        return false;
      }
      return ALLOWED_EXTENSIONS.test(item.path);
    })
    .slice(0, MAX_FILES);
}

export async function getFileContent(owner, repo, branch, filePath, token) {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  const response = await fetch(url, {
    headers: { Authorization: `token ${token}` }
  });
  if (!response.ok) return null;
  return await response.text();
}

export async function uploadFileToGitHub(owner, repo, branch, token, path, content, commitMessage) {
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

  const payload = {
    message: commitMessage || `Atualização via Repo Concatenator: ${path}`,
    content: Buffer.from(content, 'utf-8').toString('base64'),
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
