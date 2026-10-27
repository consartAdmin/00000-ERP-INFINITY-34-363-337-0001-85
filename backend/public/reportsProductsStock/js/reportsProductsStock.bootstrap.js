    // ╔══════════════════════════════════════════════════════════════════════╗
    // ║ reportsProductsStock.bootstrap.js — Bootstrap                       ║
    // ╚══════════════════════════════════════════════════════════════════════╝

    'use strict';

    import { getEls } from './reportsProductsStock.dom.js';
    import { state } from './reportsProductsStock.state.js';
    import { loadRows, downloadPdf, downloadExcel } from './reportsProductsStock.api.js';
    import { loadGroups, loadBrands } from './reportsProductsStock.lookups.js';
    import { bindFilters } from './reportsProductsStock.filters.js';
    import { mapRow, sortRows, renderTable } from './reportsProductsStock.table.js';
    import { renderPagination, setFooter, bindPagination } from './reportsProductsStock.pagination.js';
    import { setSummary } from './reportsProductsStock.summary.js';
    import { sanitize } from './reportsProductsStock.utils.js';

    function setStatus(msg, type = 'info') {
    const els = getEls();
    if (!els.statusArea) return;
    els.statusArea.textContent = msg || '';
    els.statusArea.dataset.type = type;
    }

async function load() {
  if (state.loading) state.aborter?.abort?.();
  const aborter = new AbortController();
  state.aborter = aborter;
  state.loading = true;

  try {

    setStatus('Carregando...', 'info');
    setFooter({ total: null, page: null, pages: null });

    const api = await loadRows();
    const mapped = api.rows.map(mapRow);

    const sorted = sortRows(mapped, state.order);

    renderTable(sorted);

    renderPagination({ total: api.total, page: api.page, limit: api.limit });

    // Resumo lateral: totais de TODOS os registros filtrados (não só a página).
    const pageSumStock = sorted.reduce((acc, r) => acc + (Number(r.stock) || 0), 0);
    const pageSumCost = sorted.reduce((acc, r) => acc + (Number(r.total) || 0), 0);
    setSummary({
      total: api.total,
      sum_stock: Number.isFinite(Number(api?.summary?.sum_stock)) ? Number(api.summary.sum_stock) : pageSumStock,
      sum_cost: Number.isFinite(Number(api?.summary?.sum_cost)) ? Number(api.summary.sum_cost) : pageSumCost,
      with_stock: api?.summary?.with_stock ?? sorted.filter(r => r.stock > 0).length,
      without_stock: api?.summary?.without_stock ?? sorted.filter(r => r.stock <= 0).length,
      without_cost: api?.summary?.without_cost ?? sorted.filter(r => r.cost <= 0).length,
    });

    setStatus(`${api.total} item(ns) carregado(s).`, 'success');
  } catch (err) {
    if (err?.name === 'AbortError') return;
    console.error('[reportsProductsStock] load error:', err);
    setStatus(`Erro: ${err.message || err}`, 'error');
    setFooter({ total: null, page: null, pages: null });
    setSummary(null);
  } finally {
    if (state.aborter === aborter) state.loading = false;
  }
}

    async function bootstrapLookups() {
    const els = getEls();

    try {
        const groups = await loadGroups();
        if (els.selGrupo) {
        els.selGrupo.innerHTML =
            '<option value="">Todos</option>' +
            groups.map(g => `<option value="${sanitize(g.id)}">${sanitize(g.name)}</option>`).join('');
        }
    } catch (e) {
        console.warn('[groups] falhou:', e);
    }

    try {
        const brands = await loadBrands();
        if (els.selMarca) {
        els.selMarca.innerHTML =
            '<option value="">Todas</option>' +
            brands.map(b => `<option value="${sanitize(b.id)}">${sanitize(b.name)}</option>`).join('');
        }
    } catch (e) {
        console.warn('[brands] falhou:', e);
    }
    }

    function bindExports() {
    const els = getEls();

    els.btnPdf?.addEventListener('click', async () => {
        try {
        setStatus('Gerando PDF...', 'info');
        const blob = await downloadPdf();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `posicao_estoque_${new Date().toISOString().slice(0, 10)}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setStatus('PDF gerado com sucesso.', 'success');
        } catch (err) {
        setStatus(`Falha ao gerar PDF: ${err.message || err}`, 'error');
        }
    });

    els.btnExcel?.addEventListener('click', async () => {
        try {
        setStatus('Gerando Excel...', 'info');
        const blob = await downloadExcel();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `posicao_estoque_${new Date().toISOString().slice(0, 10)}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setStatus('Excel exportado com sucesso.', 'success');
        } catch (err) {
        setStatus(`Falha ao exportar Excel: ${err.message || err}`, 'error');
        }
    });
    }

    export async function bootstrapReportsProductsStock() {
    bindFilters(load);
    bindPagination(load);
    bindExports();
    await bootstrapLookups();
    await load();
    }