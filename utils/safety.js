/**
 * Safety checks melhorados
 */

export function runSafetyChecks(files, existingPaths = []) {
  const errors = [];
  const warnings = [];

  for (const file of files) {
    const content = file.newContent || '';
    const path = file.path || '';

    // 1. Deteção de segredos hardcoded
    const secrets = detectHardcodedSecrets(content);
    for (const secret of secrets) {
      warnings.push({
        file: path,
        message: `Possível segredo hardcoded: ${secret}`,
        type: 'security'
      });
    }

    // 2. Deteção de padrões perigosos (eval, child_process, fs, etc.)
    const dangerous = detectDangerousPatterns(content);
    for (const pattern of dangerous) {
      errors.push({
        file: path,
        message: `Uso de padrão perigoso: ${pattern}`,
        type: 'security'
      });
    }

    // 3. Verificação de imports relativos inválidos (apenas aviso)
    if (/\.(js|ts|jsx|tsx)$/.test(path)) {
      const invalidImports = detectInvalidImports(content, existingPaths);
      for (const imp of invalidImports) {
        warnings.push({
          file: path,
          message: `Import '${imp}' pode não existir no projeto.`,
          type: 'import'
        });
      }
    }

    // 4. Verificação de tamanho excessivo (evitar DoS)
    if (content.length > 100000) {
      warnings.push({
        file: path,
        message: `Ficheiro muito grande (${content.length} caracteres). Pode causar lentidão.`,
        type: 'performance'
      });
    }

    // 5. Deteção de path traversal (ex: "../../../etc/passwd")
    if (/\.\.\/\.\.\//.test(content)) {
      errors.push({
        file: path,
        message: 'Possível path traversal (../) detectado.',
        type: 'security'
      });
    }
  }

  return { errors, warnings, allGood: errors.length === 0 };
}

function detectHardcodedSecrets(content) {
  const patterns = [
    /(api[_-]?key|apikey|secret|password|token|bearer|auth)\s*[:=]\s*["']([^"']{8,})["']/gi,
    /Bearer\s+["'][^"']+["']/gi,
    /sk-[a-zA-Z0-9]{20,}/g,
    /ghp_[a-zA-Z0-9]{30,}/g,
    /AIza[0-9A-Za-z-_]{35}/g // Google API key
  ];
  const found = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      found.push(match[0].substring(0, 40) + '...');
    }
  }
  return found;
}

function detectDangerousPatterns(content) {
  const patterns = [
    /\beval\s*\(/,
    /\bnew\s+Function\s*\(/,
    /\bchild_process\b/,
    /\brequire\s*\(\s*['"]child_process['"]\s*\)/,
    /\bexec\s*\(/,
    /\bspawn\s*\(/,
    /\bprocess\.exit\s*\(/,
    /\bfs\.(readFile|writeFile|unlink|rmdir|mkdir)/,
    /\b__dirname\b.*\.\.\// // possível path traversal
  ];
  const found = [];
  for (const pattern of patterns) {
    if (pattern.test(content)) {
      found.push(pattern.toString());
    }
  }
  return found;
}

function detectInvalidImports(content, existingPaths) {
  const regex = /from\s+['"]([^'"]+)['"]/g;
  const issues = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    const imp = match[1];
    if (imp.startsWith('.')) {
      const resolved = imp.replace(/\.(js|ts|jsx|tsx)$/, '');
      const exists = existingPaths.some(p =>
        p === imp ||
        p === `${imp}.js` ||
        p === `${imp}.ts` ||
        p === `${resolved}/index.js` ||
        p === `${resolved}/index.ts`
      );
      if (!exists) issues.push(imp);
    }
  }
  return issues;
}
