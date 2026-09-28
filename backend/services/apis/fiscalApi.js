// ╔═══════════════════════════════════════════════════════════════════════╗
// ║ 🧾 fiscalApi.js — Service Fiscal do Produto (CONSART)                ║
// ║ Usa também a rota auxiliar de produtos p/ perfil por classificação   ║
// ╚═══════════════════════════════════════════════════════════════════════╝

const API_BASE = location.origin;
const DEFAULT_TIMEOUT_MS = 15000;
const DEBUG = false;

// Rotas assumidas (ajuste se necessário)
const R = Object.freeze({
  classFiscal:   '/api/classificacao-fiscal',        // GET
  perfisFiscais: '/api/perfil-fiscal',               // GET
  produtoFiscal: (id) => `/api/produtos-fiscal/${id}`, // GET/PUT por produto_id
  // Auxiliar já existente nos seus produtosRoutes:
  perfilPorClass: (classId) => `/api/produtos/perfil-fiscal/classificacao/${classId}`,
});

async function http(path, { method='GET', headers={}, body, timeout=DEFAULT_TIMEOUT_MS } = {}) {
  const c=new AbortController(); const t=setTimeout(()=>c.abort(), timeout);
  const url = `${API_BASE}${path}`;
  const opts = { method, headers: { ...headers }, signal: c.signal };
  if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
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

// ▶ Listas base
export async function listarClassificacoesFiscais() { const d=await http(R.classFiscal);   return Array.isArray(d)?d:[]; }
export async function listarPerfisFiscais()        { const d=await http(R.perfisFiscais); return Array.isArray(d)?d:[]; }

// ▶ Fiscal do produto
export async function getFiscalDoProduto(produtoId) {
  const id = Number(produtoId); if (!Number.isInteger(id)||id<=0) throw new Error('produto_id inválido.');
  return http(R.produtoFiscal(id));
}
export async function salvarFiscalDoProduto(produtoId, payload = {}) {
  const id = Number(produtoId); if (!Number.isInteger(id)||id<=0) throw new Error('produto_id inválido.');
  if (!payload || typeof payload !== 'object') throw new Error('Payload inválido.');
  return http(R.produtoFiscal(id), { method: 'PUT', body: payload });
}

// ▶ Auxiliar: obter perfil fiscal sugerido a partir da classificação
export async function obterPerfilPorClassificacao(classificacaoId) {
  const cid = Number(classificacaoId); if (!Number.isInteger(cid)||cid<=0) throw new Error('classificacao_fiscal_id inválido.');
  return http(R.perfilPorClass(cid));
}
