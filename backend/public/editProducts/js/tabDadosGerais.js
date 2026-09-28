// ╔══════════════════════════════════════════════════════════════════════╗
// ║ tabDadosGerais.js — Aba Dados Gerais (Editar Produto)                ║
// ║ CONSART ERP — ESM                                                   ║
// ║ ✅ UPDATE (somente o solicitado):                                    ║
// ║   - Carregar Fabricantes e Fornecedores nos <select>                 ║
// ║   - Busca TODAS as páginas quando a API pagina                       ║
// ║   - Corrige parse/format de dimensões e peso                         ║
// ║   - NÃO mexe no resto do fluxo                                       ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

export function initDadosGeraisTab(ctx) {
  const FIELDS = {
    product_code: '#produtoId',
    description: '#descricao',
    barcode: '#codigoBarras',
    manufacturer_ref: '#refFabricante',

    product_group_id: '#product_group_id',
    product_subgroup_id: '#product_subgroup_id',
    manufacturer_id: '#manufacturer_id',
    supplier_id: '#supplier_id',

    product_location_label: '#product_location_label',
    product_location_id: '#product_location_id',
    box_id: '#box_item_id',
    cost_price: '#cost_price',


  };

  const ACTIVE_SELECTOR = '#produtoAtivo';

  const getEl = (s) => (s ? ctx.$(s) : null);
  const getVal = (s) => (getEl(s)?.value ?? '');
  const setVal = (s, v) => {
    const el = getEl(s);
    if (el) el.value = v ?? '';
  };

  const getChecked = (sel, fallback = true) => {
    const el = getEl(sel);
    if (!el) return fallback;
    return !!el.checked;
  };

  const setChecked = (sel, value) => {
    const el = getEl(sel);
    if (!el) return;
    el.checked = !!value;
  };

  // ──────────────────────────────────────────────────────────────
  // Helper Locations With Modal
  // ──────────────────────────────────────────────────────────────
  function setLocationField(row) {
    const sel = getEl(FIELDS.product_location_id);
    const input = getEl(FIELDS.product_location_label);

    if (!sel) return;

    const id =
      row?.product_location_id ??
      row?.products_location_id ??
      row?.raw?.product_location_id ??
      row?.raw?.products_location_id ??
      row?.location_id ??
      row?.raw?.location_id ??
      row?.id ??
      '';

    const label =
      row?.label ||
      row?.location_description ||
      [
        row?.store_name || row?.store_description || row?.local,
        row?.corredor,
        row?.prateleira,
        row?.bandeja,
        row?.box,
      ].filter(Boolean).join(' / ') ||
      row?.descricao ||
      '';

    if (id === '' || id == null || String(id) === '0') {
      sel.innerHTML = `<option value="">— Selecione uma localização —</option>`;
      sel.value = '';
      if (input) input.value = '';
      return;
    }

    sel.innerHTML = `
      <option value="">— Selecione uma localização —</option>
      <option value="${String(id)}" selected>${String(label || `#${id}`)}</option>
    `;
    sel.value = String(id);

    if (input) {
      input.value = String(label || `#${id}`);
      input.dataset.locationId = String(id);
      input.dataset.locationData = JSON.stringify(row);
    }
  }

  async function carregarLocalizacaoSelecionada(selectedId = null) {
    if (
      selectedId == null ||
      selectedId === '' ||
      String(selectedId) === '0'
    ) {
      setLocationField(null);
      return;
    }

    try {
      const candidates = [
        `${ctx.API_BASE}/api/products-locations/${encodeURIComponent(selectedId)}`,
        `${ctx.API_BASE}/api/productsLocations/${encodeURIComponent(selectedId)}`,
        `${ctx.API_BASE}/api/locations/${encodeURIComponent(selectedId)}`,
        `${ctx.API_BASE}/api/localizacoes/${encodeURIComponent(selectedId)}`,
      ];

      let found = null;

      for (const url of candidates) {
        try {
          const data = await ctx.jfetch(url);
          const row = data?.data || data?.row || data;
          if (row && (row.id || row.location_id || row.product_location_id)) {
            found = row;
            break;
          }
        } catch { }
      }

      if (found) {
        setLocationField({
          id: found.id ?? found.location_id ?? found.product_location_id,
          local: found.local ?? found.location ?? '',
          corredor: found.corredor ?? found.aisle ?? '',
          bandeja: found.bandeja ?? found.shelf ?? '',
          descricao: found.descricao ?? found.description ?? '',
          label:
            found.label ||
            [found.local, found.corredor, found.bandeja].filter(Boolean).join(' / ') ||
            found.descricao ||
            `#${selectedId}`,
        });
        return;
      }

      setLocationField({
        id: found.id ?? found.location_id ?? found.product_location_id,
        local: found.local ?? found.location ?? '',
        corredor: found.corredor ?? found.aisle ?? '',
        prateleira: found.prateleira ?? found.gondola ?? found.shelf ?? '',
        bandeja: found.bandeja ?? found.bin ?? '',
        box: found.box ?? '',
        descricao: found.descricao ?? found.description ?? '',
        label:
          found.label ||
          found.location_description ||
          [
            found.local,
            found.corredor,
            found.prateleira,
            found.bandeja,
            found.box,
          ].filter(Boolean).join(' / ') ||
          found.descricao ||
          `#${selectedId}`,
      });

    } catch (err) {
      console.warn('Erro ao carregar localização selecionada:', err);
      setLocationField({
        id: selectedId,
        label: `#${selectedId}`,
      });
    }
  }

  function bindLocationModal() {
    const btn = document.getElementById('btnBuscarLocalizacao');
    const input = getEl(FIELDS.product_location_label);

    if (btn && !btn.__boundLocationModal) {
      btn.__boundLocationModal = true;
      btn.addEventListener('click', () => {
        window.ProductsLocationsModal?.open({
          initialQuery: input?.value || '',
          onSelect: (row) => {
            setLocationField(row);
          },
        });
      });
    }

    if (input && !input.__boundLocationModal) {
      input.__boundLocationModal = true;
      input.addEventListener('click', () => {
        window.ProductsLocationsModal?.open({
          initialQuery: input?.value || '',
          onSelect: (row) => {
            setLocationField(row);
          },
        });
      });
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Helpers numéricos específicos para dimensões/peso
  // ──────────────────────────────────────────────────────────────
  function parseDecimalField(value) {
    if (value === null || value === undefined) return null;

    let s = String(value).trim();
    if (!s) return null;

    s = s.replace(/\s+/g, '');

    // 1.234,56 -> 1234.56
    if (s.includes('.') && s.includes(',')) {
      s = s.replace(/\./g, '').replace(',', '.');
    }
    // 1,6 -> 1.6
    else if (s.includes(',')) {
      s = s.replace(',', '.');
    }

    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function formatDecimalField(value, decimals = 3) {
    if (value === null || value === undefined || value === '') return '';
    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    return n.toFixed(decimals);
  }

  // ──────────────────────────────────────────────────────────────
  // ✅ UPDATE: FABRICANTES / FORNECEDORES (preenche <select>)
  // ──────────────────────────────────────────────────────────────
  function extractRows(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.rows)) return data.rows;

    if (data.data) {
      if (Array.isArray(data.data)) return data.data;
      if (Array.isArray(data.data.rows)) return data.data.rows;
      for (const k of Object.keys(data.data)) {
        if (Array.isArray(data.data[k])) return data.data[k];
      }
    }

    for (const k of Object.keys(data)) {
      if (Array.isArray(data[k])) return data[k];
    }

    return [];
  }

  async function fetchJsonOrThrow(url) {
    const data = await ctx.jfetch(url);
    return data;
  }

  // ✅ NOVO: tenta buscar TUDO quando a API pagina (limit/offset ou page/per_page)
  async function fetchAllPages(
    baseUrl,
    {
      limit = 500,
      maxPages = 120,
    } = {}
  ) {
    const out = [];
    const seenKeys = new Set();

    const addRows = (rows) => {
      let added = 0;

      for (const r of rows) {
        const id =
          r?.id ??
          r?.supplier_id ??
          r?.manufacturer_id ??
          r?.codigo ??
          r?.code ??
          null;

        const key = id != null ? String(id) : JSON.stringify(r);

        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        out.push(r);
        added++;
      }

      return added;
    };

    const withQuery = (url, qs) => url + (url.includes('?') ? '&' : '?') + qs;

    // 1) tenta limit/offset
    for (let i = 0; i < maxPages; i++) {
      const offset = i * limit;
      const url = withQuery(
        baseUrl,
        `limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`
      );

      const data = await fetchJsonOrThrow(url);
      const rows = extractRows(data);

      if (!rows.length) break;

      const added = addRows(rows);

      if (added === 0) break;
      if (rows.length < limit) break;
    }

    if (out.length) return out;

    // 2) fallback: page/per_page
    for (let page = 1; page <= maxPages; page++) {
      const url = withQuery(
        baseUrl,
        `page=${encodeURIComponent(page)}&per_page=${encodeURIComponent(limit)}`
      );

      const data = await fetchJsonOrThrow(url);
      const rows = extractRows(data);

      if (!rows.length) break;

      const added = addRows(rows);
      if (added === 0) break;
      if (rows.length < limit) break;
    }

    return out;
  }

  async function fillSelect(
    selEl,
    rows,
    {
      placeholder = '— Selecione —',
      idKeys = ['id'],
      textKeys = ['name', 'nome'],
      selectedValue = null,
    } = {}
  ) {
    if (!selEl) return;

    // 0 é o "sem vínculo" dos registros legados: trata como não selecionado.
    if (String(selectedValue) === '0') selectedValue = null;

    selEl.innerHTML = `<option value="">${placeholder}</option>`;

    if (!Array.isArray(rows) || !rows.length) {
      if (selectedValue != null && selectedValue !== '') {
        const opt = document.createElement('option');
        opt.value = String(selectedValue);
        opt.textContent = `#${selectedValue}`;
        opt.selected = true;
        selEl.appendChild(opt);
      }
      return;
    }

    const frag = document.createDocumentFragment();

    for (const r of rows) {
      const id = idKeys.map((k) => r?.[k]).find((v) => v != null && v !== '');
      if (id == null) continue;

      const text =
        textKeys.map((k) => r?.[k]).find((v) => v != null && v !== '') || `#${id}`;

      const opt = document.createElement('option');
      opt.value = String(id);
      opt.textContent = String(text);
      frag.appendChild(opt);
    }

    selEl.appendChild(frag);

    if (selectedValue != null && selectedValue !== '') {
      selEl.value = String(selectedValue);

      if (selEl.value !== String(selectedValue)) {
        const opt = document.createElement('option');
        opt.value = String(selectedValue);
        opt.textContent = `#${selectedValue}`;
        opt.selected = true;
        selEl.appendChild(opt);
      }
    }
  }

  async function carregarFabricantes(selectedId = null) {
    const sel = getEl(FIELDS.manufacturer_id);
    if (!sel) return;

    const candidates = [
      `${ctx.API_BASE}/api/products-manufacturers`,
      `${ctx.API_BASE}/api/manufacturers`,
      `${ctx.API_BASE}/api/fabricantes`,
    ];

    let rows = [];
    let lastErr = null;

    for (const baseUrl of candidates) {
      try {
        const data0 = await fetchJsonOrThrow(baseUrl);
        const rows0 = extractRows(data0);

        const looksPaged = [50, 100, 200].includes(rows0.length);
        rows = looksPaged
          ? await fetchAllPages(baseUrl, { limit: 500, maxPages: 120 })
          : rows0;

        if (!rows.length && rows0.length) rows = rows0;
        if (rows.length) break;
      } catch (e) {
        lastErr = e;
      }
    }

    if (!rows.length && lastErr) {
      console.warn('[tabDadosGerais] fabricantes vazio:', lastErr?.message || lastErr);
    }

    await fillSelect(sel, rows, {
      placeholder: '— Selecione um fabricante —',
      idKeys: ['manufacturer_id', 'product_manufacturer_id', 'id', 'codigo', 'code'],
      textKeys: [
        'trade_name',
        'trading_name',
        'corporate_name',
        'company_name',
        'fantasy_name',
        'razao_social',
        'nome_fantasia',
        'name',
        'nome',
      ],
      selectedValue: selectedId,
    });
  }

  async function carregarFornecedores(selectedId = null) {
    const sel = getEl(FIELDS.supplier_id);
    if (!sel) return;

    const candidates = [
      `${ctx.API_BASE}/api/products-suppliers`,
      `${ctx.API_BASE}/api/suppliers`,
      `${ctx.API_BASE}/api/fornecedores`,
    ];

    let rows = [];
    let lastErr = null;

    for (const baseUrl of candidates) {
      try {
        const data0 = await fetchJsonOrThrow(baseUrl);
        const rows0 = extractRows(data0);

        const looksPaged = [50, 100, 200].includes(rows0.length);
        rows = looksPaged
          ? await fetchAllPages(baseUrl, { limit: 500, maxPages: 150 })
          : rows0;

        if (!rows.length && rows0.length) rows = rows0;
        if (rows.length) break;
      } catch (e) {
        lastErr = e;
      }
    }

    if (!rows.length && lastErr) {
      console.warn('[tabDadosGerais] fornecedores vazio:', lastErr?.message || lastErr);
    }

    await fillSelect(sel, rows, {
      placeholder: '— Selecione um fornecedor —',
      idKeys: ['supplier_id', 'product_supplier_id', 'id', 'codigo', 'code'],
      textKeys: [
        'name',
        'company_name',
        'trading_name',
        'fantasy_name',
        'razao_social',
        'nome_fantasia',
        'nome',
      ],
      selectedValue: selectedId,
    });
  }

  async function carregarCombosAuxiliares(p) {
    await Promise.all([
      carregarFabricantes(p?.manufacturer_id ?? null).catch(() => { }),
      carregarFornecedores(p?.supplier_id ?? null).catch(() => { }),
    ]);
  }

  // ✅ NOVO: popula o select "Localização" com dados do Mapa de Localização
  async function carregarLocalizacoesDoProduto(productCode, selectedId = null) {
    const sel = getEl(FIELDS.product_location_id);
    const input = getEl(FIELDS.product_location_label);

    if (sel) {
      sel.innerHTML = `<option value="">— Selecione uma localização —</option>`;
      sel.value = '';
    }

    if (input) {
      input.value = '';
      delete input.dataset.locationId;
      delete input.dataset.locationData;
    }

    const validSelectedId =
      selectedId != null &&
      selectedId !== '' &&
      String(selectedId) !== '0';

    if (validSelectedId) {
      await carregarLocalizacaoSelecionada(selectedId);
      return;
    }

    if (!productCode) return;

    try {
      const candidates = [
        `${ctx.API_BASE}/api/products-locations/by-product/${encodeURIComponent(productCode)}`,
        `${ctx.API_BASE}/api/productsLocations/by-product/${encodeURIComponent(productCode)}`,
        `${ctx.API_BASE}/api/products-locations?product_code=${encodeURIComponent(productCode)}`,
        `${ctx.API_BASE}/api/productsLocations?product_code=${encodeURIComponent(productCode)}`,
      ];

      let rows = [];

      for (const url of candidates) {
        try {
          const data = await ctx.jfetch(url);
          rows = extractRows(data);

          if (!rows.length && data?.data) {
            rows = Array.isArray(data.data) ? data.data : [data.data];
          }

          if (!rows.length && data?.row) {
            rows = [data.row];
          }

          if (rows.length) break;
        } catch { }
      }

      const activeRow =
        rows.find((r) => r?.is_active === true || r?.active === true) ||
        rows[0] ||
        null;

      if (activeRow) {
        setLocationField({
          id:
            activeRow.id ??
            activeRow.product_location_id ??
            activeRow.products_location_id ??
            activeRow.location_id,
          product_code: activeRow.product_code,
          local: activeRow.local ?? activeRow.store_name ?? activeRow.store_description ?? '',
          corredor: activeRow.corredor ?? '',
          prateleira: activeRow.prateleira ?? activeRow.gondola ?? '',
          bandeja: activeRow.bandeja ?? '',
          box: activeRow.box ?? '',
          descricao: activeRow.descricao ?? activeRow.description ?? '',
          label:
            activeRow.label ||
            activeRow.location_description ||
            [
              activeRow.local ?? activeRow.store_name ?? activeRow.store_description,
              activeRow.corredor,
              activeRow.prateleira ?? activeRow.gondola,
              activeRow.bandeja,
              activeRow.box,
            ].filter(Boolean).join(' / '),
          raw: activeRow,
        });
      }
    } catch (err) {
      console.warn('[tabDadosGerais] erro ao carregar localização por produto:', err);
    }
  }

  async function preencherFormulario(p) {
    setVal(FIELDS.product_code, p.product_code ?? p.sku ?? '');
    setVal(FIELDS.description, p.description ?? p.descricao ?? '');
    setVal(
      FIELDS.barcode,
      ctx.normalizeBarcode(p.barcode ?? p.codigo_barras ?? p.ean ?? p.gtin ?? '')
    );
    setVal(FIELDS.manufacturer_ref, p.manufacturer_ref ?? p.ref_fabricante ?? '');

    setVal(FIELDS.product_group_id, p.product_group_id ?? p.group_id ?? '');
    setVal(FIELDS.product_subgroup_id, p.product_subgroup_id ?? p.subgroup_id ?? '');

    await carregarCombosAuxiliares(p);

    setVal(FIELDS.box_id, p.box_item_id ?? p.box_id ?? p.boxId ?? '');

    const ativoFlag =
      p.is_active !== undefined
        ? p.is_active
        : p.ativo !== undefined
          ? p.ativo
          : true;

    setChecked(ACTIVE_SELECTOR, ativoFlag);

    if (p.cost_price != null) {
      setVal(FIELDS.cost_price, ctx.Num.formatBR(p.cost_price));
    }

    const sku = p.product_code ?? p.sku ?? '';
    const selectedLocationId =
      p.product_location_id && String(p.product_location_id) !== '0'
        ? p.product_location_id
        : p.location_id && String(p.location_id) !== '0'
          ? p.location_id
          : null;

    await carregarLocalizacoesDoProduto(sku, selectedLocationId);
  }

  async function carregarBoxDoProduto(productCode) {
    try {
      const url = `${ctx.API_BASE}/api/products-boxes/by-product/${encodeURIComponent(productCode)}`;
      const data = await ctx.jfetch(url);

      const sel = ctx.$(FIELDS.box_id);
      if (!sel) return;

      sel.value = data?.data?.box_id ? String(data.data.box_id) : '';
    } catch (e) {
      console.error('Erro ao carregar box do produto', e);
      const sel = ctx.$(FIELDS.box_id);
      if (sel) sel.value = '';
    }
  }

  function coletarFormulario() {
    // Campo vazio (ex.: "-- Selecione --") deve ir como null, não 0.
    const n = (v) => (String(v ?? '').trim() === '' ? null : ctx.Num.toNumOrNull(v));

    const locationInput = getEl(FIELDS.product_location_label);

    let selectedLocation = null;

    try {
      selectedLocation = locationInput?.dataset?.locationData
        ? JSON.parse(locationInput.dataset.locationData)
        : null;
    } catch {
      selectedLocation = null;
    }

    console.log('[FRONT][SAVE_PRODUCT_LOCATION]', {
      selectValue: getVal(FIELDS.product_location_id),
      inputValue: locationInput?.value,
      selectedLocation,
    });

    return {
      product_code: getVal(FIELDS.product_code)?.trim(),
      description: getVal(FIELDS.description)?.trim(),
      barcode: ctx.normalizeBarcode(getVal(FIELDS.barcode)),
      manufacturer_ref: getVal(FIELDS.manufacturer_ref)?.trim(),

      product_group_id: n(getVal(FIELDS.product_group_id)),
      product_subgroup_id: n(getVal(FIELDS.product_subgroup_id)),
      manufacturer_id: n(getVal(FIELDS.manufacturer_id)),
      supplier_id: n(getVal(FIELDS.supplier_id)),

      // LOCATION
      product_location_id: n(getVal(FIELDS.product_location_id)),

      product_location_label:
        locationInput?.value?.trim() || null,

      local:
        selectedLocation?.local || null,

      corredor:
        selectedLocation?.corredor || null,

      prateleira:
        selectedLocation?.prateleira || selectedLocation?.gondola || selectedLocation?.raw?.prateleira || null,

      bandeja:
        selectedLocation?.bandeja || null,

      // BOX
      box_item_id: n(getVal(FIELDS.box_id)),

      cost_price: n(getVal(FIELDS.cost_price)),

      is_active: getChecked(ACTIVE_SELECTOR, true),
    };
  }

  async function salvarDadosGerais(productId) {
    const payload = coletarFormulario();

    if (!payload.product_code) {
      ctx.toast('Informe o Produto ID (SKU / product_code).', 'error');
      getEl(FIELDS.product_code)?.focus();
      return;
    }

    if (!payload.description) {
      ctx.toast('Informe a Descrição do produto.', 'error');
      getEl(FIELDS.description)?.focus();
      return;
    }

    try {
      await ctx.ProductsApi.updateProduct(productId, payload);
      ctx.toast('✅ Dados salvos com sucesso!', 'success');
    } catch (err) {
      console.error('save error:', err);
      ctx.toast(`❌ Falha ao salvar: ${err.message}`, 'error');
    }
  }

  function bindSalvarDadosGerais(productId) {
    const formGeral = document.querySelector('#formDadosGerais');
    if (!formGeral) return;

    if (formGeral.__boundSubmit) {
      formGeral.removeEventListener('submit', formGeral.__boundSubmit);
    }

    formGeral.__boundSubmit = (e) => {
      e.preventDefault();
      salvarDadosGerais(productId);
    };

    formGeral.addEventListener('submit', formGeral.__boundSubmit);
  }

  bindLocationModal();

  return {
    FIELDS,
    preencherFormulario,
    coletarFormulario,
    salvarDadosGerais,
    bindSalvarDadosGerais,
    carregarBoxDoProduto,
    carregarLocalizacoesDoProduto,
    carregarFabricantes,
    carregarFornecedores,
    carregarCombosAuxiliares,
  };
}