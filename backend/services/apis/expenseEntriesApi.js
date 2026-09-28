// ╔══════════════════════════════════════════════════════════════════════╗
// ║ expenseEntriesApi.js — PostgreSQL API (CRUD) — CONSART ERP            ║
// ║ Path: backend/services/apis/expenseEntriesApi.js                      ║
// ║ Table: public."expenseEntries"                                       ║
// ║ ESM • SQL parametrizado • paginação • filtros • ordenação segura     ║
// ║ + XML Import (NF-e) → draft                                           ║
// ║ + POST: cria/atualiza accountsPayable (SEM tocar balance gerado)      ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { parseStringPromise } from 'xml2js';

/** Helper: query com log leve (descomente se quiser) */
async function q(text, params = []) {
  // console.debug('[SQL]', text, params);
  const res = await pool.query(text, params);
  return res;
}

/** paginação */
function parsePaging({ page = 1, pageSize = 20 } = {}) {
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.min(200, Math.max(1, Number(pageSize) || 20));
  const offset = (p - 1) * ps;
  return { page: p, pageSize: ps, limit: ps, offset };
}

/** Ordenação segura (entrada aceita camelCase e/ou snake/lower) */
function parseOrder(orderBy) {
  if (!orderBy) return ' ORDER BY issuedate DESC, expenseentryid DESC ';

  // mapa: o que o frontend pode mandar -> coluna real do banco
  const map = new Map([
    ['expenseentryid', 'expenseentryid'],
    ['issuedate', 'issuedate'],
    ['entrydate', 'entrydate'],
    ['status', 'status'],
    ['documenttype', 'documenttype'],
    ['documentnumber', 'documentnumber'],
    ['documentseries', 'documentseries'],
    ['documentkey', 'documentkey'],
    ['supplierid', 'supplierid'],
    ['suppliername', 'suppliername'],
    ['supplierdocument', 'supplierdocument'],
    ['totalexpensevalue', 'totalexpensevalue'],
    ['createdat', 'createdat'],
    ['updatedat', 'updatedat'],

    // alias usados no front (sem quebrar se vierem)
    ['expenseentryid', 'expenseentryid'],
    ['issuedate', 'issuedate'],
    ['entrydate', 'entrydate'],
  ]);

  const raw = String(orderBy).trim();
  const [colRaw, dirRaw] = raw.split(/\s+/);

  const colNorm = String(colRaw || '')
    .replaceAll('"', '')
    .trim()
    .toLowerCase();

  const dir = /^(asc|desc)$/i.test(dirRaw || '') ? String(dirRaw).toUpperCase() : 'ASC';

  // normalização extra
  const camelToLower = colNorm
    .replaceAll('expenseentryid', 'expenseentryid')
    .replaceAll('issuedate', 'issuedate')
    .replaceAll('entrydate', 'entrydate');

  const colDb = map.get(camelToLower) || null;
  if (!colDb) return ' ORDER BY issuedate DESC, expenseentryid DESC ';

  return ` ORDER BY ${colDb} ${dir} `;
}

/** Monta WHERE dinâmico (SEM companyId) — usando colunas reais (minúsculas) */
function buildWhere({ status, supplierDocument, q: queryText, dateFrom, dateTo } = {}) {
  const where = [];
  const params = [];

  if (status) {
    params.push(String(status).toUpperCase());
    where.push(`status = $${params.length}`);
  }

  if (supplierDocument) {
    params.push(String(supplierDocument).trim());
    where.push(`supplierdocument = $${params.length}`);
  }

  if (dateFrom) {
    params.push(String(dateFrom));
    where.push(`issuedate >= $${params.length}::date`);
  }
  if (dateTo) {
    params.push(String(dateTo));
    where.push(`issuedate <= $${params.length}::date`);
  }

  if (queryText) {
    const qt = `%${String(queryText).trim()}%`;
    params.push(qt);
    const p = params.length;

    where.push(`(
      suppliername ILIKE $${p}
      OR documentnumber ILIKE $${p}
      OR documentseries ILIKE $${p}
      OR documentkey ILIKE $${p}
      OR notes ILIKE $${p}
    )`);
  }

  return {
    whereSql: where.length ? ` WHERE ${where.join(' AND ')} ` : '',
    params,
  };
}

/** Normaliza payload de create/update */
function normalizeEntryPayload(body = {}) {
  const toNum = (v) => (v === '' || v == null ? null : Number(v));
  const toStr = (v) => (v == null ? null : String(v));
  const toBool = (v) => (v === true || v === 'true' || v === 1 || v === '1');

  return {
    supplierId: toNum(body.supplierId),
    supplierName: toStr(body.supplierName),
    supplierDocument: toStr(body.supplierDocument),

    documentType: (toStr(body.documentType) || 'NFE').toUpperCase(),
    documentNumber: toStr(body.documentNumber),
    documentSeries: toStr(body.documentSeries),
    documentKey: toStr(body.documentKey),

    issueDate: toStr(body.issueDate),
    entryDate: toStr(body.entryDate),

    totalProductsValue: toNum(body.totalProductsValue) ?? 0,
    totalDiscountValue: toNum(body.totalDiscountValue) ?? 0,
    totalTaxValue: toNum(body.totalTaxValue) ?? 0,
    totalExpenseValue: toNum(body.totalExpenseValue) ?? 0,

    generatesTaxCredit: body.generatesTaxCredit != null ? toBool(body.generatesTaxCredit) : false,
    fiscalStatus: toStr(body.fiscalStatus) || 'NO_CREDIT',

    costCenterId: toNum(body.costCenterId),
    vehicleId: toNum(body.vehicleId),
    notes: toStr(body.notes),

    xmlPath: toStr(body.xmlPath),
    pdfPath: toStr(body.pdfPath),

    status: toStr(body.status) ? String(body.status).toUpperCase() : null,
    createdBy: toNum(body.createdBy),
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* XML Import (NF-e)                                                         */
/* ────────────────────────────────────────────────────────────────────────── */

function pick(obj, path, fallback = null) {
  try {
    let cur = obj;
    for (const k of path.split('.')) {
      if (cur == null) return fallback;
      cur = cur[k];
      if (Array.isArray(cur)) cur = cur[0];
    }
    return cur ?? fallback;
  } catch {
    return fallback;
  }
}

function toDateOnly(s) {
  if (!s) return null;
  const str = String(s);
  if (str.includes('T')) return str.slice(0, 10);
  if (str.length >= 10) return str.slice(0, 10);
  return null;
}

function toNum(v, def = 0) {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : def;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Bridge helpers: ExpenseEntry -> AccountsPayable (sem service separado)     */
/* ────────────────────────────────────────────────────────────────────────── */

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toISODateOnly(v) {
  if (!v) return null;

  // Date object
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  }

  const s = String(v).trim();

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // DD/MM/YYYY
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) {
    const [, dd, mm, yyyy] = br;
    return `${yyyy}-${mm}-${dd}`;
  }

  // Strings tipo: "Mon Feb 09" | "Mon Feb 09 2026"
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  throw new Error(`Data inválida: "${v}"`);
}

// ============================================================================
// resolveSupplierId — public.suppliers (supplier_id, name, tax_id)
// Path: backend/services/apis/expenseEntriesApi.js
// ============================================================================

function onlyDigits(v) {
  return String(v ?? '').replace(/\D+/g, '');
}

export async function resolveSupplierId(client, supplier = {}) {
  const taxIdRaw =
    supplier.tax_id ??
    supplier.taxId ??
    supplier.cnpj_cpf ??
    supplier.cnpjCpf ??
    supplier.cnpj ??
    supplier.cpf ??
    supplier.document ??
    supplier.doc ??
    '';

  const taxId = onlyDigits(taxIdRaw);

  const name =
    String(
      supplier.name ??
      supplier.nome ??
      supplier.razao_social ??
      supplier.nome_fantasia ??
      supplier.fantasia ??
      ''
    ).trim();

  // precisa de pelo menos taxId ou name
  if (!taxId && !name) return null;

  // 1) tenta achar por tax_id (melhor chave)
  if (taxId) {
    const found = await client.query(`
      select supplier_id
      from public.suppliers
      where regexp_replace(coalesce(tax_id,''), '\\\\D', '', 'g') = $1
      limit 1
      `,
      [taxId]
    );
    if (found.rowCount) return found.rows[0].supplier_id;
  }

  // 2) fallback por name (quando não tem documento)
  if (name) {
    const foundByName = await q(
      `
      select supplier_id
        from public.suppliers
       where upper(trim(name)) = upper(trim($1))
       limit 1
      `,
      [name]
    );
    if (foundByName.rowCount) return foundByName.rows[0].supplier_id;
  }

  // 3) cria fornecedor (name é NOT NULL)
  const finalName = name || (taxId ? `FORNECEDOR ${taxId}` : 'FORNECEDOR');

  // evita duplicar por taxId em corrida (2 requests simultâneos):
  // como não há UNIQUE em tax_id, fazemos "re-check" após inserir se necessário.
  const created = await q(
    `
    insert into public.suppliers (name, tax_id, phone, email, address, city, state, postal_code)
    values ($1, $2, $3, $4, $5, $6, $7, $8)
    returning supplier_id
    `,
    [
      finalName,
      taxId || null,
      supplier.phone ?? supplier.telefone ?? null,
      supplier.email ?? null,
      supplier.address ?? supplier.endereco ?? null,
      supplier.city ?? supplier.cidade ?? null,
      supplier.state ?? supplier.uf ?? null,
      supplier.postal_code ?? supplier.cep ?? null,
    ]
  );

  if (created.rowCount) return created.rows[0].supplier_id;

  // fallback final: tenta achar por taxId depois (caso inserção tenha sido bloqueada por trigger/regra)
  if (taxId) {
    const found2 = await q(
      `
      select supplier_id
        from public.suppliers
       where regexp_replace(coalesce(tax_id,''), '\\\\D', '', 'g') = $1
       limit 1
      `,
      [taxId]
    );
    if (found2.rowCount) return found2.rows[0].supplier_id;
  }

  throw new Error('Não consegui resolver/criar supplier_id em public.suppliers.');
}

export async function parseNfeXmlToExpenseEntryDraft(xmlBufferOrText) {
  const xmlText = Buffer.isBuffer(xmlBufferOrText)
    ? xmlBufferOrText.toString('utf8')
    : String(xmlBufferOrText || '');

  const parsed = await parseStringPromise(xmlText, {
    explicitArray: true,
    trim: true,
    normalize: true,
    normalizeTags: false,
    mergeAttrs: false,
  });

  const infNFe =
    pick(parsed, 'nfeProc.NFe.infNFe') ||
    pick(parsed, 'NFe.infNFe') ||
    pick(parsed, 'nfeProc.NFe[0].infNFe') ||
    null;

  if (!infNFe) throw new Error('XML inválido: infNFe não encontrado (NF-e).');

  const rawId = pick(infNFe, '$.Id') || '';
  const documentKey = rawId.startsWith('NFe') ? rawId.slice(3) : rawId;

  const issueDate = toDateOnly(pick(infNFe, 'ide.dhEmi') || pick(infNFe, 'ide.dEmi'));
  const entryDate = issueDate;

  const documentNumber = pick(infNFe, 'ide.nNF');
  const documentSeries = pick(infNFe, 'ide.serie');

  const supplierName = pick(infNFe, 'emit.xNome') || pick(infNFe, 'emit.xFant') || null;
  const supplierDocument = onlyDigits(pick(infNFe, 'emit.CNPJ') || pick(infNFe, 'emit.CPF') || '');

  const vProd = toNum(pick(infNFe, 'total.ICMSTot.vProd'), 0);
  const vDesc = toNum(pick(infNFe, 'total.ICMSTot.vDesc'), 0);
  const vTotTrib = toNum(pick(infNFe, 'total.ICMSTot.vTotTrib'), 0);
  const vNF = toNum(pick(infNFe, 'total.ICMSTot.vNF'), 0);

  const det = pick(infNFe, 'det') || [];
  const detArr = Array.isArray(det) ? det : [det];

  const items = detArr
    .map((d) => {
      const prod = (d && d.prod && d.prod[0]) ? d.prod[0] : null;
      if (!prod) return null;

      const sku = pick(prod, 'cProd');
      const description = pick(prod, 'xProd');
      const unit = pick(prod, 'uCom') || pick(prod, 'uTrib');
      const quantity = toNum(pick(prod, 'qCom') || pick(prod, 'qTrib'), 0);
      const unitPrice = toNum(pick(prod, 'vUnCom') || pick(prod, 'vUnTrib'), 0);
      const totalValue = toNum(pick(prod, 'vProd'), quantity * unitPrice);

      return {
        sku: sku ? String(sku) : null,
        description: description ? String(description) : null,
        unit: unit ? String(unit) : null,
        quantity,
        unitPrice,
        totalValue,
      };
    })
    .filter(Boolean);

  const entryDraft = {
    documentType: 'NFE',
    documentNumber: documentNumber ? String(documentNumber) : null,
    documentSeries: documentSeries ? String(documentSeries) : null,
    documentKey: documentKey || null,

    issueDate: issueDate || null,
    entryDate: entryDate || null,

    supplierName,
    supplierDocument: supplierDocument || null,

    totalProductsValue: vProd,
    totalDiscountValue: vDesc,
    totalTaxValue: vTotTrib,
    totalExpenseValue: vNF,

    generatesTaxCredit: false,
    fiscalStatus: 'NO_CREDIT',
    status: 'OPEN',

    notes: 'IMPORTADO VIA XML NF-e',
  };

  return { entryDraft, items };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* PUBLIC API                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

const SELECT_ALIASED = `
  SELECT
    expenseentryid     AS "expenseEntryId",
    supplierid         AS "supplierId",
    suppliername       AS "supplierName",
    supplierdocument   AS "supplierDocument",
    documenttype       AS "documentType",
    documentnumber     AS "documentNumber",
    documentseries     AS "documentSeries",
    documentkey        AS "documentKey",
    issuedate          AS "issueDate",
    entrydate          AS "entryDate",
    totalproductsvalue AS "totalProductsValue",
    totaldiscountvalue AS "totalDiscountValue",
    totaltaxvalue      AS "totalTaxValue",
    totalexpensevalue  AS "totalExpenseValue",
    generatestaxcredit AS "generatesTaxCredit",
    fiscalstatus       AS "fiscalStatus",
    costcenterid       AS "costCenterId",
    vehicleid          AS "vehicleId",
    notes              AS "notes",
    xmlpath            AS "xmlPath",
    pdfpath            AS "pdfPath",
    status             AS "status",
    createdby          AS "createdBy",
    createdat          AS "createdAt",
    updatedat          AS "updatedAt"
  FROM public."expenseEntries"
`;

export const expenseEntriesApi = {
  parsePaging,

  async list({ page, pageSize, orderBy, status, supplierDocument, q: qt, dateFrom, dateTo }) {
    const { limit, offset, ...pg } = parsePaging({ page, pageSize });
    const { whereSql, params } = buildWhere({ status, supplierDocument, q: qt, dateFrom, dateTo });
    const orderSql = parseOrder(orderBy);

    const countSql = `
      SELECT COUNT(*)::bigint AS total
      FROM public."expenseEntries"
      ${whereSql}
    `;

    const dataSql = `
      ${SELECT_ALIASED}
      ${whereSql}
      ${orderSql}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const countRes = await q(countSql, params);
    const total = Number(countRes.rows?.[0]?.total || 0);

    const dataRes = await q(dataSql, [...params, limit, offset]);
    return {
      paging: { ...pg, total, pageSize: limit },
      rows: dataRes.rows || [],
    };
  },

  async getById({ expenseEntryId }) {
    const id = Number(expenseEntryId);
    if (!id) throw new Error('expenseEntryId is required');

    const sql = `
      ${SELECT_ALIASED}
      WHERE expenseentryid = $1
      LIMIT 1
    `;
    const res = await q(sql, [id]);
    return res.rows?.[0] || null;
  },

  async create(body) {
    const p = normalizeEntryPayload(body);
    if (!p.issueDate) throw new Error('issueDate is required');

    const sql = `
      INSERT INTO public."expenseEntries" (
        supplierid,
        suppliername,
        supplierdocument,
        documenttype,
        documentnumber,
        documentseries,
        documentkey,
        issuedate,
        entrydate,
        totalproductsvalue,
        totaldiscountvalue,
        totaltaxvalue,
        totalexpensevalue,
        generatestaxcredit,
        fiscalstatus,
        costcenterid,
        vehicleid,
        notes,
        xmlpath,
        pdfpath,
        status,
        createdby,
        createdat,
        updatedat
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,
        $10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
        NOW(), NOW()
      )
      RETURNING expenseentryid
    `;

    const params = [
      p.supplierId,
      p.supplierName,
      p.supplierDocument,
      p.documentType,
      p.documentNumber,
      p.documentSeries,
      p.documentKey,
      p.issueDate,
      p.entryDate || p.issueDate,

      p.totalProductsValue ?? 0,
      p.totalDiscountValue ?? 0,
      p.totalTaxValue ?? 0,
      p.totalExpenseValue ?? 0,

      p.generatesTaxCredit ?? false,
      p.fiscalStatus || 'NO_CREDIT',

      p.costCenterId,
      p.vehicleId,
      p.notes,

      p.xmlPath,
      p.pdfPath,

      (p.status || 'OPEN').toUpperCase(),
      p.createdBy,
    ];

    const ins = await q(sql, params);
    const id = ins.rows?.[0]?.expenseentryid;
    return await this.getById({ expenseEntryId: id });
  },

  async update({ expenseEntryId, body }) {
    const id = Number(expenseEntryId);
    if (!id) throw new Error('expenseEntryId is required');

    // regra: não editar POSTED (segurança)
    const current = await q(`SELECT status FROM public."expenseEntries" WHERE expenseentryid = $1 LIMIT 1`, [id]);
    const st = String(current.rows?.[0]?.status || '').toUpperCase();
    if (st === 'POSTED') throw new Error('Entrada POSTED não pode ser editada.');

    const p = normalizeEntryPayload(body);

    const fields = [
      ['supplierid', p.supplierId],
      ['suppliername', p.supplierName],
      ['supplierdocument', p.supplierDocument],

      ['documenttype', p.documentType],
      ['documentnumber', p.documentNumber],
      ['documentseries', p.documentSeries],
      ['documentkey', p.documentKey],

      ['issuedate', p.issueDate],
      ['entrydate', p.entryDate],

      ['totalproductsvalue', p.totalProductsValue],
      ['totaldiscountvalue', p.totalDiscountValue],
      ['totaltaxvalue', p.totalTaxValue],
      ['totalexpensevalue', p.totalExpenseValue],

      ['generatestaxcredit', p.generatesTaxCredit],
      ['fiscalstatus', p.fiscalStatus],

      ['costcenterid', p.costCenterId],
      ['vehicleid', p.vehicleId],
      ['notes', p.notes],

      ['xmlpath', p.xmlPath],
      ['pdfpath', p.pdfPath],

      ['status', p.status ? String(p.status).toUpperCase() : null],
    ];

    const set = [];
    const params = [];

    for (const [col, val] of fields) {
      if (val !== undefined) {
        params.push(val);
        set.push(`${col} = $${params.length}`);
      }
    }

    if (!set.length) return await this.getById({ expenseEntryId: id });

    params.push(id);

    const sql = `
      UPDATE public."expenseEntries"
      SET ${set.join(', ')},
          updatedat = NOW()
      WHERE expenseentryid = $${params.length}
      RETURNING expenseentryid
    `;

    const upd = await q(sql, params);
    const outId = upd.rows?.[0]?.expenseentryid;
    if (!outId) return null;

    return await this.getById({ expenseEntryId: outId });
  },

  async cancel({ expenseEntryId }) {
    const id = Number(expenseEntryId);
    if (!id) throw new Error('expenseEntryId is required');

    // regra: não cancelar POSTED (segurança)
    const current = await q(`SELECT status FROM public."expenseEntries" WHERE expenseentryid = $1 LIMIT 1`, [id]);
    const st = String(current.rows?.[0]?.status || '').toUpperCase();
    if (st === 'POSTED') throw new Error('Entrada POSTED não pode ser cancelada.');

    const sql = `
      UPDATE public."expenseEntries"
      SET status = 'CANCELED', updatedat = NOW()
      WHERE expenseentryid = $1
      RETURNING expenseentryid
    `;
    const res = await q(sql, [id]);
    const outId = res.rows?.[0]?.expenseentryid;
    return outId ? await this.getById({ expenseEntryId: outId }) : null;
  },

  async remove({ expenseEntryId }) {
    const id = Number(expenseEntryId);
    if (!id) throw new Error('expenseEntryId is required');

    // regra: não remover POSTED (segurança)
    const current = await q(`SELECT status FROM public."expenseEntries" WHERE expenseentryid = $1 LIMIT 1`, [id]);
    const st = String(current.rows?.[0]?.status || '').toUpperCase();
    if (st === 'POSTED') throw new Error('Entrada POSTED não pode ser excluída.');

    const sql = `
      DELETE FROM public."expenseEntries"
      WHERE expenseentryid = $1
      RETURNING expenseentryid
    `;
    const res = await q(sql, [id]);
    return res.rows?.[0] || null;
  },

  /**
   * POSTAR / FINALIZAR entrada:
   * - status -> POSTED
   * - cria/atualiza accountsPayable vinculado (idempotente)
   *
   * POST /api/expense-entries/:id/post
   * body opcional: { dueDate: 'YYYY-MM-DD' }
   */
  async post({ expenseEntryId, dueDate = null } = {}) {
    const id = Number(expenseEntryId);
    if (!id) throw new Error('expenseEntryId is required');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // lock do registro
      const cur = await client.query(`
        ${SELECT_ALIASED}
        WHERE expenseentryid = $1
        LIMIT 1
        FOR UPDATE
      `, [id]);

      if (!cur.rowCount) throw new Error('Not found');

      const row = cur.rows[0];

      const statusNow = String(row.status || 'OPEN').toUpperCase();
      if (statusNow === 'CANCELED') throw new Error('Não é possível postar entrada CANCELED.');
      if (statusNow === 'POSTED') {
        // idempotente: só garante que existe o payable e retorna
      } else {
        await client.query(`
          UPDATE public."expenseEntries"
          SET status = 'POSTED', updatedat = NOW()
          WHERE expenseentryid = $1
        `, [id]);
        row.status = 'POSTED';
      }

      const issueDate = toISODateOnly(row.issueDate);
      if (!issueDate) throw new Error('issueDate is required');

      const finalDue = toISODateOnly(dueDate) || issueDate;

      // resolve supplier_id (accountsPayable exige NOT NULL)
      const supplier_id = await resolveSupplierId(client, {
        tax_id: row.supplierDocument,
        name: row.supplierName,
      });

      const total = Number(row.totalExpenseValue || 0);
      const invoice_number = row.documentNumber || null;

      const docKey = row.documentKey || null;
      const docSeries = row.documentSeries || null;

      const description =
        `DESPESA (INBOUND) ${(row.documentType || 'NFE').toUpperCase()} ` +
        `${invoice_number || '-'}${docSeries ? '/' + docSeries : ''}` +
        (docKey ? ` • CHAVE ${docKey}` : '');

      const notesBase = String(row.notes || '').trim();
      const notes = (notesBase ? notesBase + '\n' : '') + `[origem] expenseEntryId=${id}`;

      // ✅ UPSERT idempotente por source_type/source_id
      // ⚠️ NÃO inclui balance (GENERATED ALWAYS)
      const apSql = `
        INSERT INTO public."accountsPayable" (
          supplier_id,
          invoice_number,
          issue_date,
          due_date,
          payment_date,
          payment_method_id,
          description,
          category_id,
          subcategory_id,
          document_number,
          total_value,
          amount_paid,
          status,
          notes,
          attachment_url,
          source_type,
          source_id,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, NULL,
          NULL, $5, NULL, NULL, $6,
          $7, 0, 'PENDING', $8, NULL,
          'EXPENSE_ENTRY', $9,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT (source_type, source_id)
        DO UPDATE SET
          supplier_id     = EXCLUDED.supplier_id,
          invoice_number  = EXCLUDED.invoice_number,
          issue_date      = EXCLUDED.issue_date,
          due_date        = EXCLUDED.due_date,
          description     = EXCLUDED.description,
          document_number = EXCLUDED.document_number,
          total_value     = EXCLUDED.total_value,
          notes           = EXCLUDED.notes,
          updated_at      = CURRENT_TIMESTAMP
        RETURNING id, supplier_id, invoice_number, issue_date, due_date, total_value, amount_paid, balance, status
      `;

      const apParams = [
        supplier_id,
        invoice_number,
        issueDate,
        finalDue,
        description,
        (docKey || invoice_number || null),
        total,
        notes,
        id,
      ];

      const apRes = await client.query(apSql, apParams);
      const accountsPayable = apRes.rows?.[0] || null;

      await client.query('COMMIT');

      const refreshed = await q(`
        ${SELECT_ALIASED}
        WHERE expenseentryid = $1
        LIMIT 1
      `, [id]);

      return {
        ok: true,
        expenseEntry: refreshed.rows?.[0] || { ...row, status: 'POSTED' },
        accountsPayable,
      };
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      throw e;
    } finally {
      client.release();
    }
  },
};
