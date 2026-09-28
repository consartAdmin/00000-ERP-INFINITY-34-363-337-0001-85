// ╔═══════════════════════════════════════════════════════════════════════╗
// ║ 🧩 gradeApi.js — Service de Grade/Variações do Produto               ║
/* ║ Rotas alinhadas ao backend atual (gradesProdutos / gradesVinculos)   ║ */
// ╚═══════════════════════════════════════════════════════════════════════╝

const API = (typeof window !== 'undefined' && window.apiBase) ? window.apiBase : '';
const DEFAULT_TIMEOUT_MS = 15000;
const DEBUG = false;

function log(...args){ if (DEBUG) console.debug('[gradeApi]', ...args); }

// ──────────────────────────────────────────────────────────────────────────
// HTTP util
async function httpJSON(path, { method='GET', headers={}, body, timeout=DEFAULT_TIMEOUT_MS } = {}) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeout);
  const url = `${API}${path}`;
  const opts = { method, headers: { ...headers }, signal: c.signal };
  if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }

  try {
    const res = await fetch(url, opts);
    const ct = res.headers.get('content-type') || '';
    const isJson = ct.includes('application/json');

    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const payload = isJson ? await res.json() : await res.text();
        if (payload && typeof payload === 'object') msg += ` — ${payload.error || payload.message || ''}`;
        else if (payload) msg += ` — ${payload}`;
      } catch {}
      throw new Error(msg);
    }

    return isJson ? await res.json() : await res.text();
  } finally {
    clearTimeout(t);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Endpoints (documentados)
const R = Object.freeze({
  produtoById:          (id)     => `/api/produtos/${encodeURIComponent(id)}`,                 // GET
  gradesLista:          ()       => `/api/grades?limit=9999&order=g.grade ASC`,               // GET (opções de select)
  vinculosBySku:        (sku)    => `/api/produtos/${encodeURIComponent(sku)}/grades`,        // GET
  vinculosSyncBySku:    (sku)    => `/api/produtos/${encodeURIComponent(sku)}/grades-vinculos`, // PUT {mode, grades[]}
  vinculoCreate:        ()       => `/api/grades-produtos`,                                   // POST
  vinculoUpdate:        (id)     => `/api/grades-produtos/${encodeURIComponent(id)}`,         // PUT
  vinculoDelete:        (id)     => `/api/grades-produtos/${encodeURIComponent(id)}`,         // DELETE
});

// ──────────────────────────────────────────────────────────────────────────
// Produto
export async function getProdutoById(produtoId) {
  const data = await httpJSON(R.produtoById(produtoId));
  if (data && typeof data === 'object') {
    // normaliza sku para quem precisar
    data.sku = data.sku ?? data.produto_id ?? data.id_sku ?? null;
  }
  log('getProdutoById', produtoId, data);
  return data;
}

// ──────────────────────────────────────────────────────────────────────────
// Grades (catálogo) — útil para montar <select>
export async function listarGrades() {
  const res = await httpJSON(R.gradesLista());
  const list = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
  log('listarGrades', list.length);
  return list;
}

// ──────────────────────────────────────────────────────────────────────────
// Vínculos do produto (produto_id ⇄ grade_id)

// Compat: retorna vínculos de um produto por **ID numérico** (resolve SKU e busca)
export async function listarGrade(produtoId) {
  const produto = await getProdutoById(produtoId);
  if (!produto?.sku) throw new Error('SKU não encontrado para o produto.');
  const res = await httpJSON(R.vinculosBySku(produto.sku));
  const list = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
  // retorno compat: lista simples [{ grade_produto_id, grade_id, estoque }]
  log('listarGrade', produtoId, `(${produto.sku})`, list.length);
  return list;
}

// Compat: salvar grade do produto por **ID numérico**
// payload esperado (compat): { variacoes: [ { grade_id, estoque }, ... ] }
export async function salvarGrade(produtoId, payload = {}) {
  const produto = await getProdutoById(produtoId);
  if (!produto?.sku) throw new Error('SKU não encontrado para o produto.');
  const variacoes = Array.isArray(payload?.variacoes) ? payload.variacoes : [];

  // Normaliza para [{grade_id, estoque}]
  const grades = variacoes
    .map(v => ({ grade_id: Number(v.grade_id), estoque: Number.isFinite(Number(v.estoque)) ? Number(v.estoque) : 0 }))
    .filter(v => Number.isInteger(v.grade_id));

  // 1) Tenta sync em lote (se rota existir)
  try {
    const out = await httpJSON(R.vinculosSyncBySku(produto.sku), {
      method: 'PUT',
      body: { mode: 'sync', grades }
    });
    log('salvarGrade:SYNC', produto.sku, out?.count ?? '?');
    return out;
  } catch (e) {
    // se a rota não existir (404/405), cai no fallback CRUD
    if (!String(e.message).startsWith('HTTP 404') && !String(e.message).startsWith('HTTP 405')) {
      throw e;
    }
    log('salvarGrade: fallback CRUD');
  }

  // 2) Fallback CRUD: carrega vínculos atuais, faz upsert e remove os faltantes
  const atuais = await listarGrade(produtoId);
  const atuaisPorGrade = new Map(atuais.map(v => [Number(v.grade_id), v]));
  const idsMantidos = new Set();

  // upsert
  for (const g of grades) {
    const existente = atuaisPorGrade.get(g.grade_id);
    if (existente) {
      await httpJSON(R.vinculoUpdate(existente.grade_produto_id), {
        method: 'PUT',
        body: { produto_id: produto.sku, grade_id: g.grade_id, estoque: g.estoque }
      });
      idsMantidos.add(existente.grade_produto_id);
    } else {
      const created = await httpJSON(R.vinculoCreate(), {
        method: 'POST',
        body: { produto_id: produto.sku, grade_id: g.grade_id, estoque: g.estoque }
      });
      const novoId = created?.data?.grade_produto_id ?? created?.grade_produto_id ?? null;
      if (novoId) idsMantidos.add(novoId);
    }
  }

  // deletar vínculos que não estão mais na lista
  for (const v of atuais) {
    if (!idsMantidos.has(v.grade_produto_id)) {
      try { await httpJSON(R.vinculoDelete(v.grade_produto_id), { method: 'DELETE' }); }
      catch (e) { log('warn: remover vínculo antigo falhou', v.grade_produto_id, e.message); }
    }
  }

  // retorno final compat
  return { ok: true, mode: 'crud', count: grades.length };
}

// Compat: remover variação por ID do vínculo
export async function removerVariacao(variacaoId) {
  await httpJSON(R.vinculoDelete(variacaoId), { method: 'DELETE' });
  log('removerVariacao', variacaoId);
  return { ok: true, deleted: variacaoId };
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers diretos (se quiser usar explicitamente pelos módulos do front)
export async function listarVinculosPorSku(sku) {
  const res = await httpJSON(R.vinculosBySku(sku));
  return Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
}
export async function syncVinculosPorSku(sku, grades, mode = 'sync') {
  return httpJSON(R.vinculosSyncBySku(sku), { method: 'PUT', body: { mode, grades } });
}
export async function criarVinculo({ produto_id, grade_id, estoque = 0 }) {
  return httpJSON(R.vinculoCreate(), { method: 'POST', body: { produto_id, grade_id, estoque } });
}
export async function atualizarVinculo(id, { produto_id, grade_id, estoque }) {
  return httpJSON(R.vinculoUpdate(id), { method: 'PUT', body: { produto_id, grade_id, estoque } });
}
export async function removerVinculo(id) {
  return httpJSON(R.vinculoDelete(id), { method: 'DELETE' });
}
