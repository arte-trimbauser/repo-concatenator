import { IGNORED_PATHS, ALLOWED_EXTENSIONS, MAX_FILES } from './config.js';

/**
 * Obtém a árvore de ficheiros de um repositório (recursiva)
 * Usa a API de trees do GitHub.
 */
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

/**
 * Obtém o conteúdo de um ficheiro usando a API de Contents do GitHub.
 * Mais fiável que raw.githubusercontent.com porque reflete o estado real do branch.
 */
export async function getFileContent(owner, repo, branch, filePath, token) {
  // Usa a API REST /contents com ?ref= para obter o conteúdo
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json'
    }
  });
  if (!response.ok) {
    // Se o ficheiro não existir, retorna null em vez de lançar erro
    if (response.status === 404) return null;
    // Outros erros (ex: 403, 500) podem ser lançados
    throw new Error(`GitHub API error (${response.status}): ${await response.text()}`);
  }
  const data = await response.json();
  if (data.encoding === 'base64') {
    // Decodifica o conteúdo base64 para string UTF-8
    return Buffer.from(data.content, 'base64').toString('utf-8');
  }
  // Caso não seja base64 (ex: se o ficheiro for muito pequeno, a API pode devolver texto puro)
  return data.content || '';
}

/**
 * Faz upload (cria ou atualiza) de um ficheiro no GitHub.
 * Usa a API de contents com PUT.
 */
export async function uploadFileToGitHub(owner, repo, branch, token, path, content, commitMessage) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const headers = {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github.v3+json'
  };

  // Obter SHA se o ficheiro existir
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
