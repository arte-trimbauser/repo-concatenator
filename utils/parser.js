// utils/parser.js
/**
 * Extrai ficheiros de um texto com cabeçalhos do tipo:
 * // ===== ARQUIVO: caminho/ficheiro.ext =====
 * ou # ===== ARQUIVO: caminho =====
 * ou /* ===== ARQUIVO: caminho ===== */
 */
export function parseFiles(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  const files = [];
  // Regex flexível: captura comentários opcionais, "ARQUIVO:", caminho, e conteúdo até ao próximo cabeçalho
  const regex = /(?:\/\/\s*|#\s*|\/\*\s*)?={3,}\s*ARQUIVO:\s*([^\n]+?)\s*={3,}(?:\s*\*\/)?\n+([\s\S]*?)(?=(?:\n(?:\/\/\s*|#\s*|\/\*\s*)?={3,}\s*ARQUIVO:|$))/gi;
  let match;
  while ((match = regex.exec(normalized)) !== null) {
    const path = match[1].trim();
    let content = match[2];
    content = content.replace(/^\n+/, '').replace(/\n+$/, '');
    if (path && content) {
      files.push({ path, content });
    }
  }
  return files;
}
