
// ╔══════════════════════════════════════════════════════════════════════╗
// ║ supplierReturnsApi.js — API Service Devolução ao Fornecedor          ║
// ║ CONSART ERP | Node.js ESM + PostgreSQL                              ║
// ║ ✔ Importa XML NF-e de entrada completo                               ║
// ║ ✔ Importa fornecedor, destinatário, transporte, totais, pagamentos   ║
// ║ ✔ Importa impostos por item                                          ║
// ║ ✔ Permite escolher itens para gerar devolução ao fornecedor          ║
// ║ ✔ Gera draft pronto para integrar no motor atual de NF-e             ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import tecnoSpeedNfeApi from './tecnoSpeedNfeApi.js';
import { normalizeNfeStatusCode } from '../../repositories/invoicesIssued/_shared.js';

const TABLE_HEAD = 'public."supplierReturnNfe"';
const TABLE_ITEMS = 'public."supplierReturnNfeItems"';
const TABLE_IMPORTED = 'public."supplierReturnNfeImportedItems"';
const TABLE_NFE_STATUS_MAP = 'public."nfeStatusMap"';

/**
 * Status interno da devolução → code em public."nfeStatusMap".
 * DRAFT/READY ainda não foram transmitidas, então ficam como PENDENTE.
 */
const RETURN_STATUS_TO_NFE_CODE = Object.freeze({
    DRAFT: 'PENDENTE',
    READY: 'PENDENTE',
    PROCESSING: 'PROCESSANDO',
    TRANSMITTED: 'PROCESSANDO',
    AUTHORIZED: 'AUTORIZADO',
    REJECTED: 'REJEITADO',
    CANCELLED: 'CANCELADO',
});

/** code do nfeStatusMap → status interno da devolução (usado no sync, após emissão) */
const NFE_CODE_TO_RETURN_STATUS = Object.freeze({
    PENDENTE: 'PROCESSING',
    PROCESSANDO: 'PROCESSING',
    AUTORIZADO: 'AUTHORIZED',
    REJEITADO: 'REJECTED',
    DENEGADO: 'REJECTED',
    CANCELADO: 'CANCELLED',
    INUTILIZADO: 'CANCELLED',
    ERRO: 'REJECTED',
});

function toNfeStatusCode(returnStatus) {
    return RETURN_STATUS_TO_NFE_CODE[normalizeStatus(returnStatus)] || 'PENDENTE';
}

/** Subquery que resolve nfe_status_id a partir do code no parâmetro $N. */
function nfeStatusIdSql(paramIndex) {
    return `(SELECT nfe_status_id FROM ${TABLE_NFE_STATUS_MAP} WHERE code = $${paramIndex} AND is_active = TRUE LIMIT 1)`;
}

const NFE_STATUS_SELECT_SQL = `
    nsm.code AS nfe_status_code,
    nsm.name AS nfe_status_name,
    nsm.is_final AS nfe_status_is_final,
    nsm.is_authorized AS nfe_status_is_authorized`;

const NFE_STATUS_JOIN_SQL = `LEFT JOIN ${TABLE_NFE_STATUS_MAP} nsm ON nsm.nfe_status_id = sr.nfe_status_id`;

let suppliersColumnsCache = null;

function toNumber(value, fallback = 0) {
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;

    const text = String(value).trim();
    if (!text) return fallback;

    const normalized = text.includes(',')
        ? text.replace(/\./g, '').replace(',', '.')
        : text;

    const n = Number(normalized);
    return Number.isFinite(n) ? n : fallback;
}

function onlyDigits(value = '') {
    return String(value || '').replace(/\D+/g, '');
}

function cleanText(value = '') {
    return String(value || '')
        .replace(/<!\[CDATA\[/g, '')
        .replace(/\]\]>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
}

function normalizeStatus(value) {
    const s = String(value || 'DRAFT').trim().toUpperCase();

    const allowed = new Set([
        'DRAFT',
        'READY',
        'PROCESSING',
        'TRANSMITTED',
        'AUTHORIZED',
        'CANCELLED',
        'REJECTED',
    ]);

    return allowed.has(s) ? s : 'DRAFT';
}

function tagContent(xml = '', tag = '') {
    const re = new RegExp(
        `<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`,
        'i',
    );

    const m = String(xml || '').match(re);
    return cleanText(m?.[1] || '');
}

function allTagBlocks(xml = '', tag = '') {
    const re = new RegExp(
        `<(?:\\w+:)?${tag}\\b[^>]*>[\\s\\S]*?<\\/(?:\\w+:)?${tag}>`,
        'gi',
    );

    return String(xml || '').match(re) || [];
}

function firstTagBlock(xml = '', tag = '') {
    return allTagBlocks(xml, tag)[0] || '';
}

function getNfeKey(xml = '') {
    const infNfeOpen = String(xml || '').match(
        /<(?:\w+:)?infNFe\b[^>]*\bId=["']NFe(\d{44})["'][^>]*>/i,
    );

    if (infNfeOpen?.[1]) return infNfeOpen[1];

    const chNFe = onlyDigits(tagContent(xml, 'chNFe'));
    if (chNFe.length === 44) return chNFe;

    return '';
}

function getAttr(xml = '', attr = '') {
    const re = new RegExp(`\\b${attr}=["']([^"']+)["']`, 'i');
    const m = String(xml || '').match(re);
    return cleanText(m?.[1] || '');
}

function asJson(value, fallback = {}) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'object') return value;

    try {
        return JSON.parse(String(value));
    } catch {
        return fallback;
    }
}

function normalizeUf(value = '') {
    return String(value || '').trim().toUpperCase().slice(0, 2);
}

function normalizeDate(value = null) {
    const s = String(value || '').trim();
    return s || null;
}

function pickExistingColumn(columns, candidates) {
    for (const candidate of candidates) {
        if (columns.has(candidate)) return candidate;
    }

    return null;
}

async function getSuppliersColumns() {
    if (suppliersColumnsCache) return suppliersColumnsCache;

    const result = await pool.query(`
    SELECT column_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'suppliers'
  `);

    suppliersColumnsCache = new Set(result.rows.map((row) => row.column_name));
    return suppliersColumnsCache;
}

function normalizeCfopForReturn(cfopEntrada = '', supplierUf = '', emitUf = 'MG') {
    const cfop = onlyDigits(cfopEntrada).slice(0, 4);
    const ufSupplier = normalizeUf(supplierUf);
    const ufEmit = normalizeUf(emitUf || 'MG');
    const interstate = ufSupplier && ufEmit && ufSupplier !== ufEmit;

    if (cfop === '1102' || cfop === '2102') return interstate ? '6202' : '5202';
    if (cfop === '1403' || cfop === '2403') return interstate ? '6411' : '5411';
    if (cfop === '1556' || cfop === '2556') return interstate ? '6556' : '5556';
    if (cfop === '1551' || cfop === '2551') return interstate ? '6553' : '5553';

    if (cfop.startsWith('1')) return `5${cfop.slice(1)}`;
    if (cfop.startsWith('2')) return `6${cfop.slice(1)}`;

    return interstate ? '6202' : '5202';
}

async function findSupplierByDocument(taxId) {
    const doc = onlyDigits(taxId);
    if (!doc) return null;

    const columns = await getSuppliersColumns();

    const idCol = pickExistingColumn(columns, ['supplier_id', 'id']);

    const docCol = pickExistingColumn(columns, [
        'tax_id',
        'supplier_document',
        'document',
        'cnpj',
        'cnpj_cpf',
        'cnpjcpf',
        'cpf_cnpj',
    ]);

    const tradeCol = pickExistingColumn(columns, [
        'trade_name',
        'supplier_name',
        'nome_fantasia',
        'fantasy_name',
        'name',
        'razao_social',
        'legal_name',
    ]);

    const legalCol = pickExistingColumn(columns, [
        'legal_name',
        'razao_social',
        'supplier_name',
        'nome',
        'name',
    ]);

    const ieCol = pickExistingColumn(columns, [
        'state_registration',
        'ie',
        'inscricao_estadual',
        'supplier_ie',
        'inscricaoestadual',
    ]);

    const cityCol = pickExistingColumn(columns, [
        'city',
        'cidade',
        'supplier_city',
        'municipio',
    ]);

    const ufCol = pickExistingColumn(columns, [
        'state',
        'uf',
        'supplier_uf',
        'estado',
    ]);

    const cepCol = pickExistingColumn(columns, [
        'postal_code',
        'cep',
        'zip',
        'zipcode',
        'supplier_postal_code',
    ]);

    const streetCol = pickExistingColumn(columns, [
        'address_street',
        'street',
        'logradouro',
        'address',
    ]);

    const numberCol = pickExistingColumn(columns, [
        'address_number',
        'number',
        'numero',
    ]);

    const districtCol = pickExistingColumn(columns, [
        'address_district',
        'district',
        'bairro',
        'neighborhood',
    ]);

    if (!idCol || !docCol) return null;

    const result = await pool.query(
        `
      SELECT *
        FROM public.suppliers
       WHERE regexp_replace(COALESCE("${docCol}"::text, ''), '\\D', '', 'g') = $1
       ORDER BY "${idCol}" DESC
       LIMIT 1
    `,
        [doc],
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
        supplier_id: row[idCol],
        trade_name: tradeCol ? row[tradeCol] || '' : '',
        legal_name: legalCol ? row[legalCol] || '' : '',
        tax_id: docCol ? row[docCol] || '' : '',
        ie: ieCol ? onlyDigits(row[ieCol] || '') : '',
        city: cityCol ? row[cityCol] || '' : '',
        uf: ufCol ? row[ufCol] || '' : '',
        postal_code: cepCol ? onlyDigits(row[cepCol] || '') : '',
        street: streetCol ? row[streetCol] || '' : '',
        number: numberCol ? row[numberCol] || '' : '',
        district: districtCol ? row[districtCol] || '' : '',
    };
}

async function findProductByCodeOrBarcode({ cProd, cEAN }) {
    const sku = String(cProd || '').trim();
    const barcode = onlyDigits(cEAN);

    const params = [];
    const where = [];

    if (sku) {
        params.push(sku);
        where.push(`p.product_code = $${params.length}`);
    }

    if (barcode && barcode !== 'SEMGTIN') {
        params.push(barcode);
        where.push(`regexp_replace(COALESCE(p.barcode, ''), '\\D', '', 'g') = $${params.length}`);
        where.push(`EXISTS (
          SELECT 1 FROM public."productsBarCode" pb
          WHERE pb.product_code = p.product_code
            AND COALESCE(pb.is_active, TRUE) = TRUE
            AND regexp_replace(COALESCE(pb.barcode, ''), '\\D', '', 'g') = $${params.length}
        )`);
    }

    if (!where.length) return null;

    const result = await pool.query(
        `
    SELECT
      p.product_id,
      p.product_code,
      p.description,
      p.barcode,

      fc.ncm_code AS ncm,
      fc.cest_code AS cest,

      fp.icms_cst AS cst_icms,
      COALESCE(fp.pis_cst, '') AS cst_pis,
      COALESCE(fp.cofins_cst, '') AS cst_cofins

    FROM public.products p
    LEFT JOIN public."productsFiscalV2" pf
      ON pf.product_code = p.product_code
     AND pf.is_current = TRUE
     AND pf.is_active = TRUE
    LEFT JOIN public."fiscalClassificationV2" fc
      ON fc.fiscal_classification_id = pf.fiscal_classification_id
     AND fc.is_active = TRUE
    LEFT JOIN public."fiscalProfileV2" fp
      ON fp.fiscal_profile_id = fc.fiscal_profile_id
     AND fp.is_active = TRUE

    WHERE (${where.join(' OR ')})
    ORDER BY p.product_id DESC
    LIMIT 1
  `,
        params,
    );

    return result.rows[0] || null;
}

function findTaxGroup(imposto = '', group = '') {
    const block = firstTagBlock(imposto, group);
    if (!block) return '';

    const specificRe = new RegExp(
        `<(?:\\w+:)?(${group}[A-Za-z0-9]+)\\b[^>]*>[\\s\\S]*?<\\/(?:\\w+:)?\\1>`,
        'i'
    );

    const specific = block.match(specificRe);
    return specific?.[0] || block;
}

function parseAddress(addressBlock = {}) {
    return {
        street: tagContent(addressBlock, 'xLgr'),
        number: tagContent(addressBlock, 'nro'),
        complement: tagContent(addressBlock, 'xCpl'),
        district: tagContent(addressBlock, 'xBairro'),
        city_code: onlyDigits(tagContent(addressBlock, 'cMun')),
        city: tagContent(addressBlock, 'xMun'),
        uf: normalizeUf(tagContent(addressBlock, 'UF')),
        cep: onlyDigits(tagContent(addressBlock, 'CEP')),
        country_code: onlyDigits(tagContent(addressBlock, 'cPais')),
        country: tagContent(addressBlock, 'xPais'),
        phone: onlyDigits(tagContent(addressBlock, 'fone')),
    };
}

function parsePerson(block = '', addressTag = '') {
    const address = firstTagBlock(block, addressTag);

    return {
        tax_id: onlyDigits(tagContent(block, 'CNPJ') || tagContent(block, 'CPF')),
        legal_name: tagContent(block, 'xNome'),
        trade_name: tagContent(block, 'xFant') || tagContent(block, 'xNome'),
        ie: tagContent(block, 'IE'),
        im: tagContent(block, 'IM'),
        crt: tagContent(block, 'CRT'),
        cnae: tagContent(block, 'CNAE'),
        email: tagContent(block, 'email'),
        address: parseAddress(address),
    };
}

function parseTotals(totalBlock = '') {
    return {
        vBC: toNumber(tagContent(totalBlock, 'vBC'), 0),
        vICMS: toNumber(tagContent(totalBlock, 'vICMS'), 0),
        vICMSDeson: toNumber(tagContent(totalBlock, 'vICMSDeson'), 0),
        vFCP: toNumber(tagContent(totalBlock, 'vFCP'), 0),
        vBCST: toNumber(tagContent(totalBlock, 'vBCST'), 0),
        vST: toNumber(tagContent(totalBlock, 'vST'), 0),
        vFCPST: toNumber(tagContent(totalBlock, 'vFCPST'), 0),
        vFCPSTRet: toNumber(tagContent(totalBlock, 'vFCPSTRet'), 0),
        vProd: toNumber(tagContent(totalBlock, 'vProd'), 0),
        vFrete: toNumber(tagContent(totalBlock, 'vFrete'), 0),
        vSeg: toNumber(tagContent(totalBlock, 'vSeg'), 0),
        vDesc: toNumber(tagContent(totalBlock, 'vDesc'), 0),
        vII: toNumber(tagContent(totalBlock, 'vII'), 0),
        vIPI: toNumber(tagContent(totalBlock, 'vIPI'), 0),
        vIPIDevol: toNumber(tagContent(totalBlock, 'vIPIDevol'), 0),
        vPIS: toNumber(tagContent(totalBlock, 'vPIS'), 0),
        vCOFINS: toNumber(tagContent(totalBlock, 'vCOFINS'), 0),
        vOutro: toNumber(tagContent(totalBlock, 'vOutro'), 0),
        vNF: toNumber(tagContent(totalBlock, 'vNF'), 0),
    };
}

function parseTransport(transpBlock = '') {
    const transporta = firstTagBlock(transpBlock, 'transporta');
    const veicTransp = firstTagBlock(transpBlock, 'veicTransp');
    const volBlocks = allTagBlocks(transpBlock, 'vol');

    return {
        freight_mode: tagContent(transpBlock, 'modFrete'),

        carrier: {
            tax_id: onlyDigits(tagContent(transporta, 'CNPJ') || tagContent(transporta, 'CPF')),
            legal_name: tagContent(transporta, 'xNome'),
            ie: tagContent(transporta, 'IE'),
            address: tagContent(transporta, 'xEnder'),
            city: tagContent(transporta, 'xMun'),
            uf: normalizeUf(tagContent(transporta, 'UF')),
        },

        vehicle: {
            plate: tagContent(veicTransp, 'placa'),
            uf: normalizeUf(tagContent(veicTransp, 'UF')),
            rntc: tagContent(veicTransp, 'RNTC'),
        },

        volumes: volBlocks.map((vol) => ({
            quantity: toNumber(tagContent(vol, 'qVol'), 0),
            species: tagContent(vol, 'esp'),
            brand: tagContent(vol, 'marca'),
            numbering: tagContent(vol, 'nVol'),
            net_weight: toNumber(tagContent(vol, 'pesoL'), 0),
            gross_weight: toNumber(tagContent(vol, 'pesoB'), 0),
        })),
    };
}

function parseBilling(infNFe = '') {
    const cobr = firstTagBlock(infNFe, 'cobr');
    const fat = firstTagBlock(cobr, 'fat');
    const dupBlocks = allTagBlocks(cobr, 'dup');

    return {
        fatura: {
            number: tagContent(fat, 'nFat'),
            original_value: toNumber(tagContent(fat, 'vOrig'), 0),
            discount_value: toNumber(tagContent(fat, 'vDesc'), 0),
            net_value: toNumber(tagContent(fat, 'vLiq'), 0),
        },

        duplicatas: dupBlocks.map((dup, index) => ({
            number: tagContent(dup, 'nDup') || String(index + 1).padStart(3, '0'),
            due_date: tagContent(dup, 'dVenc'),
            value: toNumber(tagContent(dup, 'vDup'), 0),
        })),
    };
}

function parsePayments(infNFe = '') {
    const pag = firstTagBlock(infNFe, 'pag');
    const detPagBlocks = allTagBlocks(pag, 'detPag');

    return detPagBlocks.map((detPag) => {
        const card = firstTagBlock(detPag, 'card');

        return {
            tPag: tagContent(detPag, 'tPag'),
            vPag: toNumber(tagContent(detPag, 'vPag'), 0),
            indPag: tagContent(detPag, 'indPag'),
            xPag: tagContent(detPag, 'xPag'),
            card: {
                tpIntegra: tagContent(card, 'tpIntegra'),
                cnpj: onlyDigits(tagContent(card, 'CNPJ')),
                tBand: tagContent(card, 'tBand'),
                cAut: tagContent(card, 'cAut'),
            },
        };
    });
}

function parseAdditionalInfo(infNFe = '') {
    const infAdic = firstTagBlock(infNFe, 'infAdic');

    return {
        infAdFisco: tagContent(infAdic, 'infAdFisco'),
        infCpl: tagContent(infAdic, 'infCpl'),
    };
}

function parseReferences(infNFe = '') {
    return allTagBlocks(infNFe, 'NFref').map((ref) => ({
        refNFe: tagContent(ref, 'refNFe'),
        refCTe: tagContent(ref, 'refCTe'),
        refNFP: tagContent(ref, 'refNFP'),
        refECF: tagContent(ref, 'refECF'),
    }));
}

function parseItemTaxes(imposto = '') {
    const icms = findTaxGroup(imposto, 'ICMS');
    const ipi = firstTagBlock(imposto, 'IPI');
    const pis = findTaxGroup(imposto, 'PIS');
    const cofins = findTaxGroup(imposto, 'COFINS');

    return {
        icms: {
            orig: tagContent(icms, 'orig'),
            CST: tagContent(icms, 'CST'),
            CSOSN: tagContent(icms, 'CSOSN'),
            modBC: tagContent(icms, 'modBC'),
            vBC: toNumber(tagContent(icms, 'vBC'), 0),
            pRedBC: toNumber(tagContent(icms, 'pRedBC'), 0),
            pICMS: toNumber(tagContent(icms, 'pICMS'), 0),
            vICMS: toNumber(tagContent(icms, 'vICMS'), 0),
            modBCST: tagContent(icms, 'modBCST'),
            pMVAST: toNumber(tagContent(icms, 'pMVAST'), 0),
            pRedBCST: toNumber(tagContent(icms, 'pRedBCST'), 0),
            vBCST: toNumber(tagContent(icms, 'vBCST'), 0),
            pICMSST: toNumber(tagContent(icms, 'pICMSST'), 0),
            vICMSST: toNumber(tagContent(icms, 'vICMSST'), 0),
            vFCP: toNumber(tagContent(icms, 'vFCP'), 0),
            pFCP: toNumber(tagContent(icms, 'pFCP'), 0),
            vFCPST: toNumber(tagContent(icms, 'vFCPST'), 0),
            pFCPST: toNumber(tagContent(icms, 'pFCPST'), 0),
        },

        ipi: {
            cEnq: tagContent(ipi, 'cEnq'),
            CST: tagContent(ipi, 'CST'),
            vBC: toNumber(tagContent(ipi, 'vBC'), 0),
            pIPI: toNumber(tagContent(ipi, 'pIPI'), 0),
            vIPI: toNumber(tagContent(ipi, 'vIPI'), 0),
        },

        pis: {
            CST: tagContent(pis, 'CST'),
            vBC: toNumber(tagContent(pis, 'vBC'), 0),
            pPIS: toNumber(tagContent(pis, 'pPIS'), 0),
            vPIS: toNumber(tagContent(pis, 'vPIS'), 0),
        },

        cofins: {
            CST: tagContent(cofins, 'CST'),
            vBC: toNumber(tagContent(cofins, 'vBC'), 0),
            pCOFINS: toNumber(tagContent(cofins, 'pCOFINS'), 0),
            vCOFINS: toNumber(tagContent(cofins, 'vCOFINS'), 0),
        },
    };
}

function parseInboundNfeXml(xmlText, { emitUf = 'MG' } = {}) {
    const xml = String(xmlText || '');
    const infNFe = firstTagBlock(xml, 'infNFe') || xml;

    const ide = firstTagBlock(infNFe, 'ide');
    const emit = firstTagBlock(infNFe, 'emit');
    const dest = firstTagBlock(infNFe, 'dest');
    const total = firstTagBlock(infNFe, 'ICMSTot');
    const transp = firstTagBlock(infNFe, 'transp');

    const supplier = parsePerson(emit, 'enderEmit');
    const destination = parsePerson(dest, 'enderDest');
    const totals = parseTotals(total);
    const transport = parseTransport(transp);
    const billing = parseBilling(infNFe);
    const payments = parsePayments(infNFe);
    const additional_info = parseAdditionalInfo(infNFe);
    const references = parseReferences(infNFe);

    const header = {
        original_nfe_key: getNfeKey(xml),
        original_document_number: tagContent(ide, 'nNF'),
        original_series: tagContent(ide, 'serie'),
        original_issue_date: normalizeDate(tagContent(ide, 'dhEmi') || tagContent(ide, 'dEmi')),
        original_nat_op: tagContent(ide, 'natOp'),
        original_model: tagContent(ide, 'mod'),
        original_tp_nf: tagContent(ide, 'tpNF'),
        original_fin_nfe: tagContent(ide, 'finNFe'),
        original_ind_final: tagContent(ide, 'indFinal'),
        original_ind_pres: tagContent(ide, 'indPres'),
        original_id: getAttr(infNFe, 'Id'),

        supplier,
        destination,
        totals,
        transport,
        billing,
        payments,
        additional_info,
        references,

        original_total_value: totals.vNF,
        original_products_value: totals.vProd,

        customer_from_xml: {
            tax_id: destination.tax_id,
            legal_name: destination.legal_name,
            ie: destination.ie,
            city: destination.address?.city,
            uf: destination.address?.uf,
            address: destination.address,
        },
    };

    const dets = allTagBlocks(infNFe, 'det');

    const items = dets.map((detBlock, index) => {
        const prod = firstTagBlock(detBlock, 'prod');
        const imposto = firstTagBlock(detBlock, 'imposto');
        const taxes = parseItemTaxes(imposto);

        const cProd = tagContent(prod, 'cProd');
        const cEAN = tagContent(prod, 'cEAN');
        const xProd = tagContent(prod, 'xProd');
        const qCom = toNumber(tagContent(prod, 'qCom'), 0);
        const vUnCom = toNumber(tagContent(prod, 'vUnCom'), 0);
        const vProd = toNumber(tagContent(prod, 'vProd'), qCom * vUnCom);
        const cfopEntrada = tagContent(prod, 'CFOP');

        return {
            xml_item_no: Number(getAttr(detBlock, 'nItem')) || Number(tagContent(detBlock, 'nItem')) || index + 1,

            product_id: null,
            product_code: cProd,
            xml_product_code: cProd,
            barcode: cEAN,
            barcode_trib: tagContent(prod, 'cEANTrib'),

            description: xProd,

            quantity_original: qCom,
            quantity_return: qCom,

            unit: tagContent(prod, 'uCom') || 'UN',
            unit_trib: tagContent(prod, 'uTrib') || tagContent(prod, 'uCom') || 'UN',

            quantity_trib: toNumber(tagContent(prod, 'qTrib'), qCom),
            unit_value: vUnCom,
            unit_value_trib: toNumber(tagContent(prod, 'vUnTrib'), vUnCom),

            total_value_original: vProd,
            total_value_return: vProd,

            discount_value: toNumber(tagContent(prod, 'vDesc'), 0),
            freight_value: toNumber(tagContent(prod, 'vFrete'), 0),
            insurance_value: toNumber(tagContent(prod, 'vSeg'), 0),
            other_value: toNumber(tagContent(prod, 'vOutro'), 0),

            cfop_inbound: cfopEntrada,
            cfop: normalizeCfopForReturn(cfopEntrada, supplier?.address?.uf, emitUf),

            ncm: onlyDigits(tagContent(prod, 'NCM')).slice(0, 8),
            cest: onlyDigits(tagContent(prod, 'CEST')).slice(0, 10),
            extipi: tagContent(prod, 'EXTIPI'),
            cbenef: tagContent(prod, 'cBenef'),

            xped: tagContent(prod, 'xPed'),
            nitemped: tagContent(prod, 'nItemPed'),

            cst_icms: taxes.icms.CST || taxes.icms.CSOSN,
            cst_pis: taxes.pis.CST,
            cst_cofins: taxes.cofins.CST,

            taxes,

            selected: true,
            product_found: false,
        };
    });

    if (!header.original_nfe_key || header.original_nfe_key.length !== 44) {
        throw new Error('Não foi possível localizar a chave de 44 dígitos da NF-e no XML importado.');
    }

    if (!items.length) {
        throw new Error('Nenhum item foi localizado no XML da NF-e importada.');
    }

    return { header, items };
}

function normalizeItem(item = {}) {
    const quantity = toNumber(item.quantity ?? item.quantity_return ?? item.quantityReturn, 0);
    const unitValue = toNumber(item.unit_value ?? item.unitValue, 0);

    const totalValue = toNumber(
        item.total_value ?? item.totalValue ?? item.total_value_return ?? item.totalValueReturn,
        quantity * unitValue,
    );

    const sourceImportRaw = item.source_import_item_id ?? item.sourceImportItemId;
    const xmlItemRaw = item.xml_item_no ?? item.xmlItemNo;

    return {
        source_import_item_id:
            sourceImportRaw === null || sourceImportRaw === undefined || sourceImportRaw === ''
                ? null
                : toNumber(sourceImportRaw, null),

        xml_item_no:
            xmlItemRaw === null || xmlItemRaw === undefined || xmlItemRaw === ''
                ? null
                : toNumber(xmlItemRaw, null),

        product_id: toNumber(item.product_id ?? item.productId, 0),
        product_code: String(item.product_code ?? item.productCode ?? '').trim(),
        description: String(item.description ?? '').trim(),

        quantity,
        unit: String(item.unit ?? 'UN').trim().toUpperCase().slice(0, 10),
        unit_value: unitValue,
        total_value: totalValue,

        cfop: onlyDigits(item.cfop).slice(0, 4),
        ncm: onlyDigits(item.ncm).slice(0, 8),
        cest: onlyDigits(item.cest).slice(0, 10),

        cst_icms: String(
            item.cst_icms ??
            item.cstIcms ??
            item.taxes_json?.icms?.CST ??
            item.taxes_json?.icms?.CSOSN ??
            item.taxes?.icms?.CST ??
            item.taxes?.icms?.CSOSN ??
            item.xml_snapshot?.taxes?.icms?.CST ??
            item.xml_snapshot?.taxes?.icms?.CSOSN ??
            ''
        ).trim().slice(0, 3),

        cst_pis: String(
            item.cst_pis ??
            item.cstPis ??
            item.taxes_json?.pis?.CST ??
            item.taxes?.pis?.CST ??
            item.xml_snapshot?.taxes?.pis?.CST ??
            ''
        ).trim().slice(0, 2),

        cst_cofins: String(
            item.cst_cofins ??
            item.cstCofins ??
            item.taxes_json?.cofins?.CST ??
            item.taxes?.cofins?.CST ??
            item.xml_snapshot?.taxes?.cofins?.CST ??
            ''
        ).trim().slice(0, 2),

        xml_snapshot: asJson(item.xml_snapshot ?? item.xmlSnapshot, {}),
        taxes_json: asJson(
            item.taxes_json ??
            item.taxesJson ??
            item.taxes ??
            item.xml_snapshot?.taxes,
            {}
        ),
    };
}

function normalizeHeader(payload = {}) {
    const originalKey = onlyDigits(payload.original_nfe_key ?? payload.originalNfeKey);
    const nfeIdRaw = payload.nfe_id ?? payload.nfeId;

    const supplierObj = asJson(payload.supplier_json ?? payload.supplier, {});
    const destinationObj = asJson(payload.destination_json ?? payload.destination ?? payload.customer_from_xml, {});
    const totalsObj = asJson(payload.totals_json ?? payload.totals, {});
    const transportObj = asJson(payload.transport_json ?? payload.transport, {});
    const billingObj = asJson(payload.billing_json ?? payload.billing, {});
    const paymentsObj = Array.isArray(payload.payments)
        ? payload.payments
        : asJson(payload.payments_json ?? payload.payments, []);
    const additionalInfoObj = asJson(payload.additional_info_json ?? payload.additional_info, {});
    const referencesObj = Array.isArray(payload.references)
        ? payload.references
        : asJson(payload.references_json ?? payload.references, []);

    return {
        supplier_id: toNumber(payload.supplier_id ?? payload.supplierId, 0),
        supplier_name: String(payload.supplier_name ?? payload.supplierName ?? supplierObj.trade_name ?? supplierObj.legal_name ?? '').trim(),
        supplier_document: onlyDigits(payload.supplier_document ?? payload.supplierDocument ?? supplierObj.tax_id),

        supplier_ie: onlyDigits(payload.supplier_ie ?? payload.supplierIe ?? payload.ie ?? supplierObj.ie),
        supplier_city: String(payload.supplier_city ?? payload.supplierCity ?? supplierObj.address?.city ?? '').trim(),
        supplier_uf: normalizeUf(payload.supplier_uf ?? payload.supplierUf ?? supplierObj.address?.uf),

        original_nfe_key: originalKey,
        original_document_number: String(payload.original_document_number ?? payload.originalDocumentNumber ?? '').trim(),
        original_series: String(payload.original_series ?? payload.originalSeries ?? '').trim(),
        original_issue_date: payload.original_issue_date ?? payload.originalIssueDate ?? null,

        original_nat_op: String(payload.original_nat_op ?? payload.originalNatOp ?? '').trim(),
        original_model: String(payload.original_model ?? payload.originalModel ?? '').trim(),
        original_tp_nf: String(payload.original_tp_nf ?? payload.originalTpNf ?? '').trim(),
        original_fin_nfe: String(payload.original_fin_nfe ?? payload.originalFinNfe ?? '').trim(),

        return_reason: String(payload.return_reason ?? payload.returnReason ?? '').trim(),
        status: normalizeStatus(payload.status),

        nfe_id:
            nfeIdRaw === null || nfeIdRaw === undefined || nfeIdRaw === ''
                ? null
                : toNumber(nfeIdRaw, null),

        supplier_json: supplierObj,
        destination_json: destinationObj,
        totals_json: totalsObj,
        transport_json: transportObj,
        billing_json: billingObj,
        payments_json: paymentsObj,
        additional_info_json: additionalInfoObj,
        references_json: referencesObj,
    };
}

export async function ensureTables() {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS public."supplierReturnNfe" (
      return_id SERIAL PRIMARY KEY,
      supplier_id INTEGER NOT NULL,
      supplier_name TEXT,
      supplier_document VARCHAR(20),
      supplier_ie VARCHAR(30),
      supplier_city TEXT,
      supplier_uf VARCHAR(2),

      original_nfe_key VARCHAR(44) NOT NULL,
      original_document_number VARCHAR(20),
      original_series VARCHAR(10),
      original_issue_date TIMESTAMP NULL,

      return_reason TEXT,
      status VARCHAR(30) DEFAULT 'DRAFT',
      nfe_id INTEGER,
      total_value NUMERIC(15,2) DEFAULT 0,

      plugnotas_id TEXT,
      plugnotas_status TEXT,
      plugnotas_response JSONB,
      emitted_at TIMESTAMP NULL,
      authorized_at TIMESTAMP NULL,
      rejected_reason TEXT,

      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    );

    ALTER TABLE public."supplierReturnNfe"
      ADD COLUMN IF NOT EXISTS supplier_name TEXT,
      ADD COLUMN IF NOT EXISTS supplier_document VARCHAR(20),
      ADD COLUMN IF NOT EXISTS supplier_ie VARCHAR(30),
      ADD COLUMN IF NOT EXISTS supplier_city TEXT,
      ADD COLUMN IF NOT EXISTS supplier_uf VARCHAR(2),
      ADD COLUMN IF NOT EXISTS original_issue_date TIMESTAMP NULL,

      ADD COLUMN IF NOT EXISTS original_nat_op TEXT,
      ADD COLUMN IF NOT EXISTS original_model VARCHAR(5),
      ADD COLUMN IF NOT EXISTS original_tp_nf VARCHAR(5),
      ADD COLUMN IF NOT EXISTS original_fin_nfe VARCHAR(5),

      ADD COLUMN IF NOT EXISTS supplier_json JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS destination_json JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS totals_json JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS transport_json JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS billing_json JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS payments_json JSONB DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS additional_info_json JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS references_json JSONB DEFAULT '[]'::jsonb,

      ADD COLUMN IF NOT EXISTS plugnotas_id TEXT,
      ADD COLUMN IF NOT EXISTS plugnotas_status TEXT,
      ADD COLUMN IF NOT EXISTS plugnotas_response JSONB,
      ADD COLUMN IF NOT EXISTS emitted_at TIMESTAMP NULL,
      ADD COLUMN IF NOT EXISTS authorized_at TIMESTAMP NULL,
      ADD COLUMN IF NOT EXISTS rejected_reason TEXT,
      ADD COLUMN IF NOT EXISTS nfe_number INTEGER,
      ADD COLUMN IF NOT EXISTS nfe_status_id INTEGER;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_supplier_return_nfe_status'
      ) THEN
        ALTER TABLE public."supplierReturnNfe"
          ADD CONSTRAINT fk_supplier_return_nfe_status
          FOREIGN KEY (nfe_status_id) REFERENCES public."nfeStatusMap"(nfe_status_id)
          ON UPDATE CASCADE ON DELETE RESTRICT;
      END IF;
    END $$;

    CREATE INDEX IF NOT EXISTS idx_supplier_return_nfe_status
      ON public."supplierReturnNfe" (nfe_status_id);

    UPDATE public."supplierReturnNfe" sr
       SET nfe_status_id = nsm.nfe_status_id
      FROM public."nfeStatusMap" nsm
     WHERE sr.nfe_status_id IS NULL
       AND nsm.code = CASE UPPER(COALESCE(sr.status, 'DRAFT'))
             WHEN 'PROCESSING' THEN 'PROCESSANDO'
             WHEN 'TRANSMITTED' THEN 'PROCESSANDO'
             WHEN 'AUTHORIZED' THEN 'AUTORIZADO'
             WHEN 'REJECTED' THEN 'REJEITADO'
             WHEN 'CANCELLED' THEN 'CANCELADO'
             ELSE 'PENDENTE'
           END;

    CREATE TABLE IF NOT EXISTS public."supplierReturnNfeItems" (
      item_id SERIAL PRIMARY KEY,
      return_id INTEGER NOT NULL REFERENCES public."supplierReturnNfe"(return_id) ON DELETE CASCADE,
      source_import_item_id INTEGER,
      xml_item_no INTEGER,
      product_id INTEGER NOT NULL DEFAULT 0,
      product_code VARCHAR(50),
      description TEXT,
      quantity NUMERIC(15,4) NOT NULL,
      unit VARCHAR(10),
      unit_value NUMERIC(15,4),
      total_value NUMERIC(15,2),
      cfop VARCHAR(4),
      ncm VARCHAR(8),
      cest VARCHAR(10),
      cst_icms VARCHAR(3),
      cst_pis VARCHAR(2),
      cst_cofins VARCHAR(2)
    );

    ALTER TABLE public."supplierReturnNfeItems"
      ADD COLUMN IF NOT EXISTS source_import_item_id INTEGER,
      ADD COLUMN IF NOT EXISTS xml_item_no INTEGER,
      ADD COLUMN IF NOT EXISTS xml_snapshot JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS taxes_json JSONB DEFAULT '{}'::jsonb;

    CREATE TABLE IF NOT EXISTS public."supplierReturnNfeImportedItems" (
      import_item_id SERIAL PRIMARY KEY,
      original_nfe_key VARCHAR(44) NOT NULL,
      xml_item_no INTEGER,
      product_id INTEGER,
      product_code VARCHAR(50),
      xml_product_code VARCHAR(80),
      barcode VARCHAR(50),
      description TEXT,
      quantity_original NUMERIC(15,4),
      quantity_return NUMERIC(15,4),
      unit VARCHAR(10),
      unit_value NUMERIC(15,4),
      total_value_original NUMERIC(15,2),
      total_value_return NUMERIC(15,2),
      cfop_inbound VARCHAR(4),
      cfop VARCHAR(4),
      ncm VARCHAR(8),
      cest VARCHAR(10),
      cst_icms VARCHAR(3),
      cst_pis VARCHAR(2),
      cst_cofins VARCHAR(2),
      product_found BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT now()
    );

    ALTER TABLE public."supplierReturnNfeImportedItems"
      ADD COLUMN IF NOT EXISTS barcode_trib VARCHAR(50),
      ADD COLUMN IF NOT EXISTS unit_trib VARCHAR(10),
      ADD COLUMN IF NOT EXISTS quantity_trib NUMERIC(15,4),
      ADD COLUMN IF NOT EXISTS unit_value_trib NUMERIC(15,6),
      ADD COLUMN IF NOT EXISTS discount_value NUMERIC(15,2),
      ADD COLUMN IF NOT EXISTS freight_value NUMERIC(15,2),
      ADD COLUMN IF NOT EXISTS insurance_value NUMERIC(15,2),
      ADD COLUMN IF NOT EXISTS other_value NUMERIC(15,2),
      ADD COLUMN IF NOT EXISTS extipi VARCHAR(20),
      ADD COLUMN IF NOT EXISTS cbenef VARCHAR(20),
      ADD COLUMN IF NOT EXISTS xped VARCHAR(60),
      ADD COLUMN IF NOT EXISTS nitemped VARCHAR(20),
      ADD COLUMN IF NOT EXISTS xml_snapshot JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS taxes_json JSONB DEFAULT '{}'::jsonb;

    CREATE INDEX IF NOT EXISTS idx_supplier_return_status
      ON public."supplierReturnNfe" (status);

    CREATE INDEX IF NOT EXISTS idx_supplier_return_supplier
      ON public."supplierReturnNfe" (supplier_id);

    CREATE INDEX IF NOT EXISTS idx_supplier_return_original_key
      ON public."supplierReturnNfe" (original_nfe_key);

    CREATE INDEX IF NOT EXISTS idx_supplier_return_import_key
      ON public."supplierReturnNfeImportedItems" (original_nfe_key);
  `);
}

export async function importInboundXml({ buffer, xmlText, emitUf = 'MG' } = {}) {
    await ensureTables();

    const xml = xmlText || buffer?.toString('utf8') || '';
    if (!xml.trim()) throw new Error('Arquivo XML vazio ou inválido.');

    const parsed = parseInboundNfeXml(xml, { emitUf });
    const supplierMatch = await findSupplierByDocument(parsed.header.supplier.tax_id);

    parsed.header.supplier_id = supplierMatch?.supplier_id || null;

    parsed.header.supplier_name =
        supplierMatch?.trade_name ||
        supplierMatch?.legal_name ||
        parsed.header.supplier.trade_name ||
        parsed.header.supplier.legal_name ||
        '';

    parsed.header.supplier_document =
        supplierMatch?.tax_id ||
        parsed.header.supplier.tax_id ||
        '';

    parsed.header.supplier_ie =
        parsed.header.supplier.ie ||
        supplierMatch?.ie ||
        '';

    parsed.header.supplier_city =
        parsed.header.supplier.address?.city ||
        supplierMatch?.city ||
        '';

    parsed.header.supplier_uf =
        parsed.header.supplier.address?.uf ||
        supplierMatch?.uf ||
        '';

    parsed.header.supplier_found = Boolean(supplierMatch?.supplier_id);

    if (supplierMatch) {
        parsed.header.supplier.erp_match = supplierMatch;
    }

    const enrichedItems = [];

    for (const item of parsed.items) {
        const product = await findProductByCodeOrBarcode({
            cProd: item.xml_product_code,
            cEAN: item.barcode,
        });

        enrichedItems.push({
            ...item,

            product_id: product?.product_id || null,
            product_code: product?.product_code || item.xml_product_code,
            description: product?.description || item.description,

            ncm: product?.ncm || item.ncm,
            cest: product?.cest || item.cest,

            cst_icms: item.cst_icms || product?.cst_icms || item.taxes?.icms?.CST || item.taxes?.icms?.CSOSN || '',
            cst_pis: item.cst_pis || product?.cst_pis || item.taxes?.pis?.CST || '',
            cst_cofins: item.cst_cofins || product?.cst_cofins || item.taxes?.cofins?.CST || '',

            product_found: Boolean(product?.product_id),

            xml_snapshot: item,
            taxes_json: item.taxes || {},
        });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        await client.query(
            `DELETE FROM ${TABLE_IMPORTED} WHERE original_nfe_key = $1`,
            [parsed.header.original_nfe_key],
        );

        const savedItems = [];

        for (const item of enrichedItems) {
            const inserted = await client.query(
                `
          INSERT INTO ${TABLE_IMPORTED} (
            original_nfe_key,
            xml_item_no,
            product_id,
            product_code,
            xml_product_code,
            barcode,
            description,
            quantity_original,
            quantity_return,
            unit,
            unit_value,
            total_value_original,
            total_value_return,
            cfop_inbound,
            cfop,
            ncm,
            cest,
            cst_icms,
            cst_pis,
            cst_cofins,
            product_found,
            barcode_trib,
            unit_trib,
            quantity_trib,
            unit_value_trib,
            discount_value,
            freight_value,
            insurance_value,
            other_value,
            extipi,
            cbenef,
            xped,
            nitemped,
            xml_snapshot,
            taxes_json,
            header_json
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
            $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
            $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
            $31,$32,$33,$34::jsonb,$35::jsonb,$36::jsonb
          )
          RETURNING *
        `,
                [
                    parsed.header.original_nfe_key,
                    item.xml_item_no,
                    item.product_id,
                    item.product_code || null,
                    item.xml_product_code || null,
                    item.barcode || null,
                    item.description || null,
                    item.quantity_original,
                    item.quantity_return,
                    item.unit,
                    item.unit_value,
                    item.total_value_original,
                    item.total_value_return,
                    item.cfop_inbound || null,
                    item.cfop || null,
                    item.ncm || null,
                    item.cest || null,
                    item.cst_icms || null,
                    item.cst_pis || null,
                    item.cst_cofins || null,
                    item.product_found,
                    item.barcode_trib || null,
                    item.unit_trib || null,
                    item.quantity_trib || null,
                    item.unit_value_trib || null,
                    item.discount_value || 0,
                    item.freight_value || 0,
                    item.insurance_value || 0,
                    item.other_value || 0,
                    item.extipi || null,
                    item.cbenef || null,
                    item.xped || null,
                    item.nitemped || null,
                    JSON.stringify(item.xml_snapshot || item),
                    JSON.stringify(item.taxes_json || item.taxes || {}),
                    JSON.stringify(parsed.header || {}),
                ],
            );

            savedItems.push(inserted.rows[0]);
        }

        await client.query('COMMIT');

        return {
            header: parsed.header,
            items: savedItems,
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

export async function list({ page = 1, limit = 20, q = '', status = '' } = {}) {
    await ensureTables();

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    const offset = (safePage - 1) * safeLimit;

    const params = [];
    const where = [];

    if (q) {
        params.push(`%${String(q).trim()}%`);

        where.push(`(
      sr.original_nfe_key ILIKE $${params.length}
      OR sr.original_document_number ILIKE $${params.length}
      OR sr.return_reason ILIKE $${params.length}
      OR COALESCE(sr.supplier_name, '') ILIKE $${params.length}
      OR COALESCE(sr.supplier_document, '') ILIKE $${params.length}
    )`);
    }

    if (status) {
        params.push(normalizeStatus(status));
        where.push(`sr.status = $${params.length}`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const totalResult = await pool.query(
        `
      SELECT COUNT(*)::int AS total
        FROM ${TABLE_HEAD} sr
        ${whereSql}
    `,
        params,
    );

    const dataResult = await pool.query(
        `
SELECT
    sr.*,

    COALESCE(sr.supplier_name, '') AS supplier_name,
    COALESCE(sr.supplier_document, '') AS supplier_document,

    sr.plugnotas_response->'data'->0->>'numero' AS nfe_number,
    sr.plugnotas_response->'data'->0->>'serie' AS nfe_series,
    sr.plugnotas_response->'data'->0->>'status' AS plug_status,
    ${NFE_STATUS_SELECT_SQL}
    FROM ${TABLE_HEAD} sr
      ${NFE_STATUS_JOIN_SQL}
      ${whereSql}
      ORDER BY sr.return_id DESC
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
    `,
        [...params, safeLimit, offset],
    );

    return {
        page: safePage,
        limit: safeLimit,
        total: totalResult.rows[0]?.total || 0,
        rows: dataResult.rows,
    };
}

export async function getById(returnId) {
    await ensureTables();

    const id = toNumber(returnId, 0);
    if (!id) return null;

    const head = await pool.query(
        `
      SELECT
        sr.*,
        COALESCE(sr.supplier_name, '') AS supplier_name,
        COALESCE(sr.supplier_document, '') AS supplier_document,
        ${NFE_STATUS_SELECT_SQL}
      FROM ${TABLE_HEAD} sr
      ${NFE_STATUS_JOIN_SQL}
      WHERE sr.return_id = $1
    `,
        [id],
    );

    if (!head.rowCount) return null;

    const items = await pool.query(
        `SELECT * FROM ${TABLE_ITEMS} WHERE return_id = $1 ORDER BY item_id ASC`,
        [id],
    );

    return {
        ...head.rows[0],
        supplier_json: asJson(head.rows[0].supplier_json, {}),
        destination_json: asJson(head.rows[0].destination_json, {}),
        totals_json: asJson(head.rows[0].totals_json, {}),
        transport_json: asJson(head.rows[0].transport_json, {}),
        billing_json: asJson(head.rows[0].billing_json, {}),
        payments_json: asJson(head.rows[0].payments_json, []),
        additional_info_json: asJson(head.rows[0].additional_info_json, {}),
        references_json: asJson(head.rows[0].references_json, []),
        items: items.rows.map((item) => ({
            ...item,
            xml_snapshot: asJson(item.xml_snapshot, {}),
            taxes_json: asJson(item.taxes_json, {}),
        })),
    };
}

export async function create(payload = {}) {
    await ensureTables();

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        let items = Array.isArray(payload.items)
            ? payload.items.map(normalizeItem).filter((item) => item.quantity > 0)
            : [];

        items = await Promise.all(items.map(async (item) => {
            if (!item.source_import_item_id) return item;

            const r = await pool.query(
                `SELECT * FROM ${TABLE_IMPORTED} WHERE import_item_id = $1 LIMIT 1`,
                [item.source_import_item_id]
            );

            const imported = r.rows[0];
            if (!imported) return item;

            const importedSnapshot = asJson(imported.xml_snapshot, {});
            const importedTaxes = asJson(imported.taxes_json, {});

            return {
                ...item,

                cst_icms:
                    item.cst_icms ||
                    imported.cst_icms ||
                    importedTaxes?.icms?.CST ||
                    importedTaxes?.icms?.CSOSN ||
                    importedSnapshot?.taxes?.icms?.CST ||
                    importedSnapshot?.taxes?.icms?.CSOSN ||
                    '',

                cst_pis:
                    item.cst_pis ||
                    imported.cst_pis ||
                    importedTaxes?.pis?.CST ||
                    importedSnapshot?.taxes?.pis?.CST ||
                    '',

                cst_cofins:
                    item.cst_cofins ||
                    imported.cst_cofins ||
                    importedTaxes?.cofins?.CST ||
                    importedSnapshot?.taxes?.cofins?.CST ||
                    '',

                xml_snapshot:
                    Object.keys(item.xml_snapshot || {}).length
                        ? item.xml_snapshot
                        : importedSnapshot,

                taxes_json:
                    Object.keys(item.taxes_json || {}).length
                        ? item.taxes_json
                        : importedTaxes,
            };
        }));

        let header = normalizeHeader(payload);

        const firstSourceImportId =
            items.find((i) => i.source_import_item_id)?.source_import_item_id || null;

        if (firstSourceImportId) {
            const h = await pool.query(
                `SELECT header_json FROM ${TABLE_IMPORTED} WHERE import_item_id = $1 LIMIT 1`,
                [firstSourceImportId]
            );

            const importedHeader = asJson(h.rows[0]?.header_json, {});

            header = normalizeHeader({
                ...payload,

                supplier_json:
                    payload.supplier_json ||
                    importedHeader.supplier ||
                    {},

                destination_json:
                    payload.destination_json ||
                    importedHeader.destination ||
                    {},

                totals_json:
                    payload.totals_json ||
                    importedHeader.totals ||
                    {},

                transport_json:
                    payload.transport_json ||
                    importedHeader.transport ||
                    {},

                billing_json:
                    payload.billing_json ||
                    importedHeader.billing ||
                    {},

                payments_json:
                    payload.payments_json ||
                    importedHeader.payments ||
                    [],

                additional_info_json:
                    payload.additional_info_json ||
                    importedHeader.additional_info ||
                    {},

                references_json:
                    payload.references_json ||
                    importedHeader.references ||
                    [],

                original_nat_op:
                    payload.original_nat_op ||
                    importedHeader.original_nat_op,

                original_model:
                    payload.original_model ||
                    importedHeader.original_model,

                original_tp_nf:
                    payload.original_tp_nf ||
                    importedHeader.original_tp_nf,

                original_fin_nfe:
                    payload.original_fin_nfe ||
                    importedHeader.original_fin_nfe,
            });
        }

        console.log('[SUPPLIER RETURN][CREATE PAYLOAD ITEMS]', JSON.stringify(payload.items, null, 2));
        console.log('[SUPPLIER RETURN][CREATE NORMALIZED HEADER]', JSON.stringify(header, null, 2));
        console.log('[SUPPLIER RETURN][CREATE NORMALIZED ITEMS]', JSON.stringify(items, null, 2));

        if (!header.supplier_id) {
            throw new Error('Fornecedor é obrigatório. Importe uma NF-e de entrada vinculada a um fornecedor cadastrado.');
        }

        if (header.original_nfe_key.length !== 44) {
            throw new Error('Chave da NF-e original deve conter 44 dígitos.');
        }

        if (!items.length) {
            throw new Error('Selecione ao menos um item para devolução.');
        }

        for (const item of items) {
            if (!item.product_id && !item.product_code) {
                throw new Error(`Item ${item.description || ''} sem produto vinculado.`);
            }

            if (!item.cfop || item.cfop.length !== 4) {
                throw new Error(`Item ${item.description || item.product_code} sem CFOP de devolução.`);
            }
        }

        const totalValue = items.reduce((acc, item) => acc + toNumber(item.total_value, 0), 0);

        const inserted = await client.query(
            `
        INSERT INTO ${TABLE_HEAD} (
          supplier_id,
          supplier_name,
          supplier_document,
          supplier_ie,
          supplier_city,
          supplier_uf,
          original_nfe_key,
          original_document_number,
          original_series,
          original_issue_date,
          original_nat_op,
          original_model,
          original_tp_nf,
          original_fin_nfe,
          return_reason,
          status,
          nfe_id,
          total_value,
          supplier_json,
          destination_json,
          totals_json,
          transport_json,
          billing_json,
          payments_json,
          additional_info_json,
          references_json,
          nfe_status_id
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          $11,$12,$13,$14,$15,$16,$17,$18,
          $19::jsonb,$20::jsonb,$21::jsonb,$22::jsonb,$23::jsonb,$24::jsonb,$25::jsonb,$26::jsonb,
          ${nfeStatusIdSql(27)}
        )
        RETURNING *
      `,
            [
                header.supplier_id,
                header.supplier_name || null,
                header.supplier_document || null,
                header.supplier_ie || null,
                header.supplier_city || null,
                header.supplier_uf || null,
                header.original_nfe_key,
                header.original_document_number || null,
                header.original_series || null,
                header.original_issue_date || null,
                header.original_nat_op || null,
                header.original_model || null,
                header.original_tp_nf || null,
                header.original_fin_nfe || null,
                header.return_reason || null,
                header.status,
                header.nfe_id,
                totalValue,
                JSON.stringify(header.supplier_json || {}),
                JSON.stringify(header.destination_json || {}),
                JSON.stringify(header.totals_json || {}),
                JSON.stringify(header.transport_json || {}),
                JSON.stringify(header.billing_json || {}),
                JSON.stringify(header.payments_json || []),
                JSON.stringify(header.additional_info_json || {}),
                JSON.stringify(header.references_json || []),
                toNfeStatusCode(header.status),
            ],
        );

        const returnId = inserted.rows[0].return_id;

        for (const item of items) {
            await client.query(
                `
          INSERT INTO ${TABLE_ITEMS} (
            return_id,
            source_import_item_id,
            xml_item_no,
            product_id,
            product_code,
            description,
            quantity,
            unit,
            unit_value,
            total_value,
            cfop,
            ncm,
            cest,
            cst_icms,
            cst_pis,
            cst_cofins,
            xml_snapshot,
            taxes_json
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb
          )
        `,
                [
                    returnId,
                    item.source_import_item_id,
                    item.xml_item_no,
                    item.product_id || 0,
                    item.product_code || null,
                    item.description || null,
                    item.quantity,
                    item.unit,
                    item.unit_value,
                    item.total_value,
                    item.cfop || null,
                    item.ncm || null,
                    item.cest || null,
                    item.cst_icms || null,
                    item.cst_pis || null,
                    item.cst_cofins || null,
                    JSON.stringify(item.xml_snapshot || {}),
                    JSON.stringify(item.taxes_json || {}),
                ],
            );
        }

        await client.query('COMMIT');

        return getById(returnId);
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

export async function update(returnId, payload = {}) {
    await ensureTables();

    const id = toNumber(returnId, 0);
    if (!id) throw new Error('ID inválido.');

    const current = await getById(id);
    if (!current) return null;

    if (['AUTHORIZED', 'CANCELLED'].includes(current.status)) {
        throw new Error('Devolução autorizada/cancelada não pode ser alterada.');
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const header = normalizeHeader({ ...current, ...payload });

        const items = Array.isArray(payload.items)
            ? payload.items.map(normalizeItem).filter((item) => item.quantity > 0)
            : null;

        if (!header.supplier_id) {
            throw new Error('Fornecedor é obrigatório.');
        }

        if (header.original_nfe_key.length !== 44) {
            throw new Error('Chave da NF-e original deve conter 44 dígitos.');
        }

        let totalValue = toNumber(current.total_value, 0);

        if (items) {
            if (!items.length) {
                throw new Error('Informe ao menos um item para devolução.');
            }

            for (const item of items) {
                if (!item.product_id && !item.product_code) {
                    throw new Error(`Item ${item.description || ''} sem produto vinculado.`);
                }

                if (!item.cfop || item.cfop.length !== 4) {
                    throw new Error(`Item ${item.description || item.product_code} sem CFOP de devolução.`);
                }
            }

            totalValue = items.reduce((acc, item) => acc + toNumber(item.total_value, 0), 0);
        }

        await client.query(
            `
        UPDATE ${TABLE_HEAD}
           SET supplier_id = $1,
               supplier_name = $2,
               supplier_document = $3,
               supplier_ie = $4,
               supplier_city = $5,
               supplier_uf = $6,
               original_nfe_key = $7,
               original_document_number = $8,
               original_series = $9,
               original_issue_date = $10,
               original_nat_op = $11,
               original_model = $12,
               original_tp_nf = $13,
               original_fin_nfe = $14,
               return_reason = $15,
               status = $16,
               nfe_id = $17,
               total_value = $18,
               supplier_json = $19::jsonb,
               destination_json = $20::jsonb,
               totals_json = $21::jsonb,
               transport_json = $22::jsonb,
               billing_json = $23::jsonb,
               payments_json = $24::jsonb,
               additional_info_json = $25::jsonb,
               references_json = $26::jsonb,
               nfe_status_id = ${nfeStatusIdSql(28)},
               updated_at = now()
         WHERE return_id = $27
      `,
            [
                header.supplier_id,
                header.supplier_name || null,
                header.supplier_document || null,
                header.supplier_ie || null,
                header.supplier_city || null,
                header.supplier_uf || null,
                header.original_nfe_key,
                header.original_document_number || null,
                header.original_series || null,
                header.original_issue_date || null,
                header.original_nat_op || null,
                header.original_model || null,
                header.original_tp_nf || null,
                header.original_fin_nfe || null,
                header.return_reason || null,
                header.status,
                header.nfe_id,
                totalValue,
                JSON.stringify(header.supplier_json || {}),
                JSON.stringify(header.destination_json || {}),
                JSON.stringify(header.totals_json || {}),
                JSON.stringify(header.transport_json || {}),
                JSON.stringify(header.billing_json || {}),
                JSON.stringify(header.payments_json || []),
                JSON.stringify(header.additional_info_json || {}),
                JSON.stringify(header.references_json || []),
                id,
                toNfeStatusCode(header.status),
            ],
        );

        if (items) {
            await client.query(`DELETE FROM ${TABLE_ITEMS} WHERE return_id = $1`, [id]);

            for (const item of items) {
                await client.query(
                    `
            INSERT INTO ${TABLE_ITEMS} (
              return_id,
              source_import_item_id,
              xml_item_no,
              product_id,
              product_code,
              description,
              quantity,
              unit,
              unit_value,
              total_value,
              cfop,
              ncm,
              cest,
              cst_icms,
              cst_pis,
              cst_cofins,
              xml_snapshot,
              taxes_json
            ) VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb
            )
          `,
                    [
                        id,
                        item.source_import_item_id,
                        item.xml_item_no,
                        item.product_id || 0,
                        item.product_code || null,
                        item.description || null,
                        item.quantity,
                        item.unit,
                        item.unit_value,
                        item.total_value,
                        item.cfop || null,
                        item.ncm || null,
                        item.cest || null,
                        item.cst_icms || null,
                        item.cst_pis || null,
                        item.cst_cofins || null,
                        JSON.stringify(item.xml_snapshot || {}),
                        JSON.stringify(item.taxes_json || {}),
                    ],
                );
            }
        }

        await client.query('COMMIT');

        return getById(id);
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

export async function remove(returnId) {
    await ensureTables();

    const id = toNumber(returnId, 0);
    if (!id) throw new Error('ID inválido.');

    const current = await getById(id);
    if (!current) return null;

    if (current.status === 'AUTHORIZED') {
        throw new Error('Devolução autorizada não pode ser excluída.');
    }

    /*
     * Itens primeiro: no banco, supplierReturnNfeItems_return_id_fkey foi
     * criada sem ON DELETE CASCADE (a tabela é anterior ao DDL atual).
     */
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        await client.query(`DELETE FROM ${TABLE_ITEMS} WHERE return_id = $1`, [id]);
        await client.query(`DELETE FROM ${TABLE_HEAD} WHERE return_id = $1`, [id]);
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    return current;
}

export async function buildNfeDraft(returnId) {
    const data = await getById(returnId);
    if (!data) return null;

    const normalizeTaxItem = (item = {}) => {
        const taxesJson = asJson(item.taxes_json, {});
        const xmlSnapshot = asJson(item.xml_snapshot, {});

        const cstIcms =
            item.cst_icms ||
            taxesJson?.icms?.CST ||
            taxesJson?.icms?.CSOSN ||
            xmlSnapshot?.taxes?.icms?.CST ||
            xmlSnapshot?.taxes?.icms?.CSOSN ||
            '';

        const cstPis =
            item.cst_pis ||
            taxesJson?.pis?.CST ||
            xmlSnapshot?.taxes?.pis?.CST ||
            '';

        const cstCofins =
            item.cst_cofins ||
            taxesJson?.cofins?.CST ||
            xmlSnapshot?.taxes?.cofins?.CST ||
            '';

        return {
            nItem: item.xml_item_no || item.item_id || null,
            item_id: item.item_id,
            source_import_item_id: item.source_import_item_id,
            xml_item_no: item.xml_item_no,

            product_id: item.product_id,
            product_code: item.product_code,
            description: item.description,

            quantity: Number(item.quantity || 0),
            unit: item.unit,
            unit_value: Number(item.unit_value || 0),
            total_value: Number(item.total_value || 0),

            cfop: item.cfop,
            ncm: item.ncm,
            cest: item.cest,

            cst_icms: cstIcms,
            cst_pis: cstPis,
            cst_cofins: cstCofins,

            xml_snapshot: xmlSnapshot,
            taxes: taxesJson,
        };
    };

    const draft = {
        operation_type: 'SUPPLIER_RETURN',

        nfe: {
            tpNF: '1',
            finNFe: '4',
            natOp: 'DEVOLUCAO DE COMPRA',
            NFref: [{ refNFe: data.original_nfe_key }],
        },

        supplier_return: {
            return_id: data.return_id,
            supplier_id: data.supplier_id,
            supplier_name: data.supplier_name,
            supplier_document: data.supplier_document,
            supplier_ie: data.supplier_ie,
            supplier_city: data.supplier_city,
            supplier_uf: data.supplier_uf,
            original_nfe_key: data.original_nfe_key,
            original_document_number: data.original_document_number,
            original_series: data.original_series,
            original_issue_date: data.original_issue_date,
            original_nat_op: data.original_nat_op,
            original_model: data.original_model,
            original_tp_nf: data.original_tp_nf,
            original_fin_nfe: data.original_fin_nfe,
            total_value: data.total_value,
            return_reason: data.return_reason,
            status: data.status,

            supplier_json: data.supplier_json || {},
            destination_json: data.destination_json || {},
            totals_json: data.totals_json || {},
            transport_json: data.transport_json || {},
            billing_json: data.billing_json || {},
            payments_json: data.payments_json || [],
            additional_info_json: data.additional_info_json || {},
            references_json: data.references_json || [],
        },

        destinatario: {
            supplier_id: data.supplier_id,
            name: data.supplier_name,
            document: data.supplier_document,
            ie: data.supplier_ie,
            city: data.supplier_city,
            uf: data.supplier_uf,
            address: data.supplier_json?.address || {},
        },

        transport: data.transport_json || {},
        billing: data.billing_json || {},
        payments: data.payments_json || [],
        additional_info: data.additional_info_json || {},
        references: data.references_json || [],

        items: (data.items || []).map(normalizeTaxItem),
    };

    console.log('[SUPPLIER RETURN][DRAFT]', JSON.stringify(draft, null, 2));

    return draft;
}

export async function emitNfe(returnId) {
    const id = toNumber(returnId, 0);
    if (!id) throw new Error('ID inválido.');

    const draft = await buildNfeDraft(id);
    if (!draft) throw new Error('Devolução não encontrada.');

    const result = await tecnoSpeedNfeApi.emitirNFeSupplierReturn(draft);

    console.log('[SUPPLIER RETURN][TECNOSPEED RESULT]', JSON.stringify(result, null, 2));

    if (!result?.ok) {
        const msg =
            result?.message ||
            result?.error?.message ||
            result?.error ||
            'Falha ao emitir NF-e de devolução.';

        await pool.query(
            `
        UPDATE ${TABLE_HEAD}
           SET status = 'REJECTED',
               nfe_status_id = ${nfeStatusIdSql(4)},
               rejected_reason = $1,
               plugnotas_response = $2::jsonb,
               updated_at = now()
         WHERE return_id = $3
      `,
            [String(msg), JSON.stringify(result || {}), id, toNfeStatusCode('REJECTED')],
        );

        throw new Error(String(msg));
    }

    const data = result.data || {};

    const firstDocument =
        data.documents?.[0] ||
        data.documentos?.[0] ||
        data[0] ||
        data;

    const plugnotasId =
        firstDocument?.id ||
        firstDocument?.idNotaFiscal ||
        firstDocument?.idIntegracao ||
        data.id ||
        null;

    const plugStatus =
        firstDocument?.situacao ||
        firstDocument?.status ||
        data.situacao ||
        data.status ||
        data.message ||
        'PROCESSING';

    const nfeNumber =
        firstDocument?.numero ||
        firstDocument?.numeroNfe ||
        firstDocument?.nNF ||
        firstDocument?.nfeNumero ||
        data.numero ||
        data.numeroNfe ||
        data.nNF ||
        null;

    await pool.query(
        `
  UPDATE ${TABLE_HEAD}
     SET status = $1,
         nfe_status_id = ${nfeStatusIdSql(7)},
         plugnotas_id = $2,
         plugnotas_status = $3,
         plugnotas_response = $4::jsonb,
         nfe_number = $5,
         emitted_at = now(),
         updated_at = now()
   WHERE return_id = $6
`,
        [
            'PROCESSING',
            plugnotasId,
            String(plugStatus || 'PROCESSING'),
            JSON.stringify(result),
            nfeNumber ? Number(nfeNumber) : null,
            id,
            toNfeStatusCode('PROCESSING'),
        ],
    );

    return {
        ...result,
        plugnotas_id: plugnotasId,
        plugnotas_status: plugStatus,
    };
}

export async function downloadXml(returnId) {
    const data = await getById(returnId);
    if (!data) throw new Error('Devolução não encontrada.');
    if (!data.plugnotas_id) throw new Error('NF-e ainda não possui ID PlugNotas.');

    return tecnoSpeedNfeApi.obterXml(data.plugnotas_id);
}

export async function downloadPdf(returnId) {
    const data = await getById(returnId);
    if (!data) throw new Error('Devolução não encontrada.');
    if (!data.plugnotas_id) throw new Error('NF-e ainda não possui ID PlugNotas.');

    return tecnoSpeedNfeApi.obterPdf(data.plugnotas_id);
}

export async function syncPlugNotas(returnId) {
    await ensureTables();

    const id = toNumber(returnId, 0);
    if (!id) throw new Error('ID inválido.');

    const data = await getById(id);
    if (!data) throw new Error('Devolução não encontrada.');
    if (!data.plugnotas_id) throw new Error('NF-e ainda não possui ID PlugNotas.');

    const result = await tecnoSpeedNfeApi.consultarNFe(data.plugnotas_id);

    console.log('[SUPPLIER RETURN][SYNC PLUGNOTAS]', JSON.stringify(result, null, 2));

    // PlugNotas responde { ok, data: [ { status: 'CONCLUIDO', numero, cStat, ... } ], status: 200 }
    const response = result?.data || result || {};
    const doc = Array.isArray(response)
        ? response[0] || {}
        : response.documentos?.[0] || response.documents?.[0] || response;

    const nfeNumber =
        doc?.numero ||
        doc?.numeroNfe ||
        doc?.nNF ||
        null;

    const statusPlug =
        doc?.situacao ||
        (typeof doc?.status === 'string' ? doc.status : '') ||
        (Number(doc?.cStat) === 100 ? 'AUTORIZADO' : '') ||
        'PROCESSING';

    // Situação PlugNotas → code do nfeStatusMap (AUTORIZADO, REJEITADO, CANCELADO...)
    const plugCode = normalizeNfeStatusCode(statusPlug);
    const nfeStatusCode = NFE_CODE_TO_RETURN_STATUS[plugCode] ? plugCode : 'PROCESSANDO';
    const returnStatus = NFE_CODE_TO_RETURN_STATUS[nfeStatusCode];
    const authorized = nfeStatusCode === 'AUTORIZADO';

    await pool.query(
        `
        UPDATE ${TABLE_HEAD}
           SET status = $1,
               nfe_status_id = ${nfeStatusIdSql(7)},
               plugnotas_status = $2,
               plugnotas_response = $3::jsonb,
               nfe_number = COALESCE($4, nfe_number),
               authorized_at = CASE WHEN $5 THEN COALESCE(authorized_at, now()) ELSE authorized_at END,
               updated_at = now()
         WHERE return_id = $6
        `,
        [
            returnStatus,
            String(statusPlug || 'PROCESSING'),
            JSON.stringify(result || {}),
            nfeNumber ? Number(nfeNumber) : null,
            authorized,
            id,
            nfeStatusCode,
        ],
    );

    return getById(id);
}

export default {
    ensureTables,
    importInboundXml,
    list,
    getById,
    create,
    update,
    remove,
    buildNfeDraft,
    emitNfe,
    downloadXml,
    downloadPdf,
    syncPlugNotas,
};