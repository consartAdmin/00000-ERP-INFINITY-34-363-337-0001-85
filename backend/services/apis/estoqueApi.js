// ╔═══════════════════════════════════════════════════════════════════════╗
// ║ 📦 estoqueApi.js — Service de Estoque (CONSART)                      ║
// ║ Leitura via Produtos (dados-gerais) e atualização via rota estoque   ║
// ╚═══════════════════════════════════════════════════════════════════════╝

const API_BASE = location.origin;
const DEFAULT_TIMEOUT_MS = 15000;
const DEBUG = false;

// Reuso das rotas de produtos:
const R = Object.freeze({
  dadosGerais: (id) => `/api/produtos/${id}/dados-gerais`,  // GET (traz estoque, min, max)
  atualizar:   (id) => `/api/produtos/estoque/${id}`,       // PUT { quantidade, modo }
});

async function http(path, { method='GET', headers={}, body, timeout=DEFAULT_TIMEOUT_MS } = {}) {
  const c=new AbortController(); const t=setTimeout(()=>c.abort(), timeout);
  const url=`${API_BASE}${path}`;
  const opts={ method, headers:{...headers}, signal:c.signal };
  if (body !== undefined) { opts.body=JSON.stringify(body); opts.headers['Content-Type']='application/json'; }
  try {
    const res=await fetch(url, opts);
    if(!res.ok){ let msg=`HTTP ${res.status}`; try{ const ct=res.headers.get('content-type')||''; if(ct.includes('json')){ const j=await res.json(); msg+=` — ${j.erro||j.message||''}` } else { const tx=await res.text(); if(tx) msg+=` — ${tx}`; } }catch{} throw new Error(msg); }
    const ct=res.headers.get('content-type')||''; const data=ct.includes('json')?await res.json():await res.text();
    if(DEBUG) console.debug(`[HTTP ${method}]`, path, data); return data;
  } finally { clearTimeout(t); }
}

// ▶ Ler estoque atual (via dados gerais)
export async function getEstoque(produtoId) {
  const id=Number(produtoId); if(!Number.isInteger(id)||id<=0) throw new Error('produto_id inválido.');
  const d = await http(R.dadosGerais(id));
  // Normaliza campos esperados
  return {
    estoque:      d?.estoque ?? null,
    estoque_min:  d?.estoque_min ?? null,
    estoque_max:  d?.estoque_max ?? null,
    produto_id:   id,
  };
}

// ▶ Atualizar estoque (set/inc/dec)
export async function atualizarEstoque(produtoId, { quantidade, modo='set' } = {}) {
  const id=Number(produtoId); if(!Number.isInteger(id)||id<=0) throw new Error('produto_id inválido.');
  return http(R.atualizar(id), { method:'PUT', body:{ quantidade, modo } }); // { ok:true }
}
