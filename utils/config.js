export const IGNORED_PATHS = [
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb',
  'node_modules/', '.git/', 'dist/', 'build/', '.next/', '.cache/',
  '.env', '.env.local', '*.min.js', '*.min.css'
];

export const DEFAULT_BRANCH = 'main';
export const MAX_FILES = 200;           // aumentado
export const MAX_CONTEXT_CHARS = 30000;
export const ALLOWED_EXTENSIONS = /\.(js|html|css|json|md|py|sh|ts|jsx|tsx|txt|yml|yaml|xml|sql|env\.example|vue|svelte|go|rs|rb|php|java|kt|scala|lua|r|jl|c|cpp|h|hpp|cs|fs|clj|ex|exs|erl|hrl|cr|nim|zig|v|dart|pl|pm|t|ps1|psm1|tf|tfvars|hcl|dockerfile|ini|conf|cfg)$/i;

export const AI_DEFAULTS = {
  model: 'gemini-flash-latest',   // atualizado
  temperature: 0.2,
  maxOutputTokens: 8192
};
