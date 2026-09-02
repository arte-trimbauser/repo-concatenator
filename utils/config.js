// utils/config.js
export const IGNORED_PATHS = [
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb',
  'node_modules/', '.git/', 'dist/', 'build/', '.next/', '.cache/',
  '.env', '.env.local', '*.min.js', '*.min.css'
];

export const DEFAULT_BRANCH = 'main';
export const MAX_FILES = 60;          // limite de ficheiros analisados
export const MAX_CONTEXT_CHARS = 30000; // limite de caracteres por ficheiro (para contexto)
export const ALLOWED_EXTENSIONS = /\.(js|html|css|json|md|py|sh|ts|jsx|tsx|txt|yml|yaml|xml|sql|env\.example)$/i;

export const AI_DEFAULTS = {
  model: 'gemini-1.5-flash',
  temperature: 0.2,
  maxOutputTokens: 8192
};
