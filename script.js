async function fetchRepo() {
  const urlInput = document.getElementById('repoUrl').value.trim();
  const status = document.getElementById('status');
  const output = document.getElementById('output');
  status.textContent = 'Buscando arquivos...';
  output.value = '';

  // Extrai owner, repo, branch e path da URL
  const match = urlInput.match(/github\.com\/([^\/]+)\/([^\/]+)(?:\/tree\/([^\/]+)(?:\/(.+))?)?/);
  if (!match) {
    status.textContent = 'URL inválida. Use o formato: https://github.com/usuario/repo/tree/branch';
    return;
  }

  const owner = match[1];
  const repo = match[2];
  const branch = match[3] || 'main'; // branch padrão
  const basePath = match[4] ? match[4] + '/' : '';

  try {
    // 1. Obter a árvore de arquivos (recursiva)
    const treeResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
    if (!treeResponse.ok) throw new Error('Falha ao obter árvore: ' + treeResponse.status);
    const treeData = await treeResponse.json();
    
    // Filtra apenas arquivos (tipo "blob") que estão dentro do basePath (se houver)
    const files = treeData.tree.filter(item => 
      item.type === 'blob' && 
      item.path.startsWith(basePath) &&
      /\.(js|ts|py|html|css|json|md|java|cpp|c|php|rb|go|rs|swift|kt|sh|yml|yaml|xml|sql|txt)$/i.test(item.path)
    );

    if (files.length === 0) {
      status.textContent = 'Nenhum arquivo de código encontrado.';
      return;
    }

    // 2. Para cada arquivo, buscar conteúdo via raw
    let result = '';
    for (const file of files) {
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file.path}`;
      try {
        const contentResponse = await fetch(rawUrl);
        if (contentResponse.ok) {
          const content = await contentResponse.text();
          result += `\n\n// ===== ARQUIVO: ${file.path} =====\n\n${content}`;
        } else {
          result += `\n\n// ===== ARQUIVO: ${file.path} (erro ao carregar) =====\n`;
        }
      } catch (err) {
        result += `\n\n// ===== ARQUIVO: ${file.path} (erro de rede) =====\n`;
      }
    }

    output.value = result;
    status.textContent = `Encontrados ${files.length} arquivos.`;
  } catch (error) {
    status.textContent = 'Erro: ' + error.message;
  }
}

function copyAll() {
  const output = document.getElementById('output');
  output.select();
  document.execCommand('copy');
  alert('Copiado!');
}
