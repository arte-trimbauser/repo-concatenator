// utils/safety.js
/**
 * Funções de safety checks (leves, sem ESLint)
 */

export function runSafetyChecks(files, existingPaths = []) {
  const errors = [];
  const warnings = [];

  for (const file of files) {
    // 1. Deteção de segredos hardcoded
    const secrets = detectHardcodedSecrets(file.newContent);
    for (const secret of secrets) {
      warnings.push({
        file: file.path,
        message: `Possível segredo hardcoded: ${secret}`,
        type: 'security'
      });
    }

    // 2. Verificação de imports relativos inválidos (apenas aviso)
    if (['.js', '.ts', '.jsx', '.tsx'].some(ext => file.path.endsWith(ext))) {
      const invalidImports = detectInvalidImports(file.newContent, existingPaths);
      for (const imp of invalidImports) {
        warnings.push({
          file: file.path,
          message: `Import '${imp}' pode não existir no projeto.`,
          type: 'import'
        });
      }
    }

    // 3. Verificação de possíveis SQL injection ou eval (apenas aviso)
    if (/eval\s*\(/.test(file.newContent)) {
      warnings.push({
        file: file.path,
        message: 'Uso de eval() detectado – possível risco de segurança.',
        type: 'code_quality'
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
    /ghp_[a-zA-Z0-9]{30,}/g
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

function detectInvalidImports(content, existingPaths) {
  const regex = /from\s+['"]([^'"]+)['"]/g;
  const issues = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    const imp = match[1];
    if (imp.startsWith('.')) {
      // Verifica se existe nos paths existentes
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
