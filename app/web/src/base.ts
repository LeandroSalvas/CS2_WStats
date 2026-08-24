/**
 * Base pública da aplicação (prefixo de path), resolvida em runtime.
 *
 * O servidor injeta o valor real em `index.html` via `window.__APP_BASE__`
 * (variável PUBLIC_BASE_PATH), permitindo servir a SPA sob proxy reverso
 * com sub-path (ex.: https://host/cs2/) sem rebuild da imagem.
 * Fallbacks: import.meta.env.BASE_URL do Vite ou "/" na raiz.
 */
declare global {
  interface Window {
    __APP_BASE__?: string;
  }
}

function normalizeBase(raw: string | undefined): string {
  let p = raw && raw.trim() !== "" ? raw.trim() : "/";
  if (p === "./") p = "/";
  if (!p.startsWith("/")) p = `/${p}`;
  return p.endsWith("/") ? p : `${p}/`;
}

export const BASE: string = normalizeBase(
  typeof window !== "undefined" ? window.__APP_BASE__ : undefined,
);
