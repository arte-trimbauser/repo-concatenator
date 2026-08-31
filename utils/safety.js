import { ESLint } from 'eslint';

/**
 * Verifica se há segredos hardcoded no código
 */
function detectHardcodedSecrets(content) {
  const patterns = [
    /(api[_-]?key|apikey|secret|password|token|bearer|auth)\s*[:=]\s*["']([^"']{8,})["']/gi,
    /Bearer\s+["'][^"']+["']/gi,
    /sk-[a-zA-Z0-9]{20,}/g, // OpenAI keys
    /ghp_[a-zA-Z0-9]{30,}/g // GitHub tokens
  ];
  const found = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      found.push(match[0].substring(0, 50) + '...');
    }
  }
  return found;
}

/**
 * Verifica se os imports são válidos (apenas verifica existência de caminhos relativos)
 */
function detectInvalidImports(content, allFilePaths) {
  const importRegex = /from\s+['"]([^'"]+)['"]/g;
  const issues = [];
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1];
    if (importPath.startsWith('.')) {
      // Caminho relativo - verifica se existe na lista de ficheiros
      const resolvedPath = importPath.replace(/\.(js|ts|jsx|tsx)$/, '');
      const exists = allFilePaths.some(p => 
        p === importPath || 
        p === `${importPath}.js` || 
        p === `${importPath}.ts` ||
        p === `${resolvedPath}/index.js`
      );
      if (!exists) {
        issues.push(`Import '${importPath}' não encontrado no projeto.`);
      }
    }
  }
  return issues;
}

/**
 * Função principal de verificação de segurança
 */
export async function runSafetyChecks(files, allFilePaths = []) {
  const results = {
    errors: [],
    warnings: [],
    allGood: true
  };

  // 1. Verificar ESLint (apenas para JS/TS)
  try {
    const eslint = new ESLint({ 
      fix: false,
      useEslintrc: false,
      baseConfig: {
        parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
        env: { node: true, es2022: true },
        rules: {
          'no-undef': 'warn',
          'no-unused-vars': 'warn',
          'no-var': 'error',
          'prefer-const': 'warn'
        }
      }
    });

    for (const file of files) {
      const ext = file.path.split('.').pop();
      if (['js', 'ts', 'jsx', 'tsx'].includes(ext)) {
        const lintResults = await eslint.lintText(file.newContent, { 
          filePath: file.path 
        });
        const messages = lintResults[0]?.messages || [];
        const errors = messages.filter(m => m.severity === 2);
        const warnings = messages.filter(m => m.severity === 1);
        
        for (const err of errors) {
          results.errors.push({
            file: file.path,
            line: err.line,
            column: err.column,
            message: err.message,
            ruleId: err.ruleId
          });
        }
        for (const warn of warnings) {
          results.warnings.push({
            file: file.path,
            line: warn.line,
            column: warn.column,
            message: warn.message,
            ruleId: warn.ruleId
          });
        }
      }
    }
  } catch (err) {
    // ESLint pode falhar em ambientes serverless, apenas registamos
    console.warn('ESLint não disponível:', err.message);
  }

  // 2. Verificar segredos hardcoded
  for (const file of files) {
    const secrets = detectHardcodedSecrets(file.newContent);
    for (const secret of secrets) {
      results.warnings.push({
        file: file.path,
        message: `Possível segredo hardcoded: ${secret}`,
        type: 'security'
      });
    }
  }

  // 3. Verificar imports inválidos
  const paths = allFilePaths.map(p => p.path || p);
  for (const file of files) {
    const invalidImports = detectInvalidImports(file.newContent, paths);
    for (const imp of invalidImports) {
      results.warnings.push({
        file: file.path,
        message: imp,
        type: 'import'
      });
    }
  }

  results.allGood = results.errors.length === 0;
  return results;
}