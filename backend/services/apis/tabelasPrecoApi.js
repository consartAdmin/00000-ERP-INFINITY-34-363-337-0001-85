// ╔═══════════════════════════════════════════════════════════════════════╗
// ║ 💲 tabelasPrecoApi.js — Service de Tabelas & Preços (CONSART)        ║
// ║ Ajuste os caminhos em R conforme seu back-end                         ║
// ╚═══════════════════════════════════════════════════════════════════════╝

const API_BASE = location.origin;
const DEFAULT_TIMEOUT_MS = 15000;
const DEBUG = false;

// Rotas assumidas (ajuste se necessário)
const R = Object.freeze({
  tabelas:          '/api/tabela-precos',                 // GET
  precosDoProduto:  (id) => `/api/precos-produtos/${id}`, // GET por produto_id
  upsertPreco:      '/api/precos-produtos',               // POST (upsert)
  removerPreco:     (id) => `/api/precos-produtos/${id}`, // DELETE (opcional)
});

async function http(path, { method='GET', headers={}, body, timeout=DEFAULT_TIMEOUT_MS } = {}) {
  const c = new AbortController(); const t = setTimeout(()=>c.abort(), timeout);
  const url = `${API_BASE}${path}`;
  const opts = { method, headers: { ...headers }, signal: c.signal };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  try {
    const res = await fetch(url, opts);
    if (!res.ok) {
      let msg = `HTTP ${res.status}`; try { const ct=res.headers.get('content-type')||''; if (ct.includes('json')) { const j=await res.json(); msg+=` — ${j.erro||j.message||''}` } else { const tx=await res.text(); if(tx) msg+=` — ${tx}`; } } catch {}
      throw new Error(msg);
    }
    const ct = res.headers.get('content-type')||'';
    const data = ct.includes('json') ? await res.json() : await res.text();
    if (DEBUG) console.debug(`[HTTP ${method}]`, path, data);
    return data;
  } finally { clearTimeout(t); }
}

// ▶ Listar tabelas de preço
export async function listarTabelasPreco() {
  const data = await http(R.tabelas);
  return Array.isArray(data) ? data : [];
}

// ▶ Listar preços do produto (por produto_id)
export async function listarPrecosDoProduto(produtoId) {
  const id = Number(produtoId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('produto_id inválido.');
  const data = await http(R.precosDoProduto(id));
  return Array.isArray(data) ? data : (data?.rows || []);
}

// ▶ Criar/atualizar preço (upsert)
// Exemplo payload: { produto_id, tabela_preco_id, unidade, preco_venda, markup?, lucro? }
export async function salvarPrecoProduto(payload = {}) {
  if (!payload || typeof payload !== 'object') throw new Error('Payload inválido.');
  return http(R.upsertPreco, { method: 'POST', body: payload });
}

// ▶ Remover preço (opcional — se existir no seu back)
// `precoId` = id da linha de preço
export async function removerPrecoProduto(precoId) {
  const id = Number(precoId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('preco_id inválido.');
  return http(R.removerPreco(id), { method: 'DELETE' });
}
