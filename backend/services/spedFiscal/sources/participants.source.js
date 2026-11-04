// ╔══════════════════════════════════════════════════════════════════════╗
// ║ participants.source.js                                              ║
// ║ Fonte de participantes: clientes, fornecedores e transportadoras     ║
// ║ CONSART ERP                                                         ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../../config/db.js';

// Comparação de cidade sem acento/maiúsculas ("SAO PAULO" = "São Paulo").
const ACCENTS_FROM = 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ';
const ACCENTS_TO = 'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn';

function cityKeySql(expression) {
  return `UPPER(TRIM(translate(COALESCE(${expression}, ''), '${ACCENTS_FROM}', '${ACCENTS_TO}')))`;
}

function ibgeByCityLateral(cityExpr, stateExpr, alias) {
  return `
      LEFT JOIN LATERAL (
        SELECT l.ibge_code
        FROM public."ibgeLocations" l
        WHERE UPPER(l.state) = UPPER(TRIM(COALESCE(${stateExpr}, '')))
          AND ${cityKeySql('l.city')} = ${cityKeySql(cityExpr)}
        ORDER BY l.status DESC, l.ibge_location_id ASC
        LIMIT 1
      ) ${alias} ON true`;
}

function onlyDigits(value) {
  return String(value ?? '').replace(/\D+/g, '');
}

function splitDocument(value) {
  const doc = onlyDigits(value);

  return {
    cnpj: doc.length === 14 ? doc : '',
    cpf: doc.length === 11 ? doc : ''
  };
}

function normalizeParticipant(row, tipo = 'customer') {
  const doc = splitDocument(row.documento);
  const prefix = tipo === 'supplier'
    ? 'F'
    : tipo === 'transporter'
      ? 'T'
      : 'C';

  return {
    // COD_PART must be unique across every participant type.
    codigo: row.codigo === null || row.codigo === undefined
      ? ''
      : `${prefix}${String(row.codigo).trim()}`,
    nome: row.nome || '',
    cod_pais: '1058',
    cnpj: doc.cnpj,
    cpf: doc.cpf,
    ie: row.ie || '',
    cod_mun: onlyDigits(row.cod_mun || ''),
    suframa: row.suframa || '',
    endereco: row.endereco || '',
    numero: row.numero || '',
    complemento: row.complemento || '',
    bairro: row.bairro || '',
    cidade: row.city || '',
    uf: row.state || '',
    tipo
  };
}

async function getCustomers() {
  try {
    const { rows } = await pool.query(`
      SELECT
        c.customer_id::text AS codigo,
        COALESCE(c.trade_name, c.legal_name, '') AS nome,
        c.tax_id AS documento,
        c.state_registration AS ie,
        COALESCE(NULLIF(ci.codigo_ibge::text, ''), il.ibge_code::text, '') AS cod_mun,
        c.street_name AS endereco,
        c.street_number AS numero,
        c.address_complement AS complemento,
        c.neighborhood AS bairro,
        c.city,
        c.state,
        ''::text AS suframa
      FROM customers c
      LEFT JOIN "customersIbge" ci
        ON ci.customer_id = c.customer_id
      ${ibgeByCityLateral('c.city', 'c.state', 'il')}
      WHERE COALESCE(c.is_active, true) = true
      ORDER BY COALESCE(c.trade_name, c.legal_name), c.customer_id
    `);

    return rows.map(row => normalizeParticipant(row, 'customer'));
  } catch (err) {
    console.error('[SPED Fiscal] getCustomers participants error:', err.message);
    return [];
  }
}

/*
 * Fornecedor sem cidade/UF no cadastro: usa o <cMun> do emitente no XML
 * das NF-e de entrada guardadas pelo DF-e (nfeInbox).
 */
async function fillSupplierMunicipalityFromXml(suppliers = []) {
  const missing = suppliers.filter(p => !p.cod_mun && (p.cnpj || p.cpf));
  if (!missing.length) return;

  try {
    const { rows } = await pool.query(
      `
        SELECT DISTINCT ON (doc)
          doc,
          substring(ni.xml_completo FROM '<enderEmit>.*?<cMun>([0-9]{7})</cMun>') AS cod_mun
        FROM (
          SELECT unnest($1::text[]) AS doc
        ) d
        JOIN public."nfeInbox" ni
          ON regexp_replace(COALESCE(ni.emitente_cnpj, ''), '\\D+', '', 'g') = d.doc
        WHERE ni.xml_completo LIKE '%<enderEmit>%'
        ORDER BY doc, ni.data_emissao DESC NULLS LAST
      `,
      [missing.map(p => p.cnpj || p.cpf)],
    );

    const byDoc = new Map(rows.filter(r => r.cod_mun).map(r => [r.doc, r.cod_mun]));
    for (const participant of missing) {
      participant.cod_mun = byDoc.get(participant.cnpj || participant.cpf) || '';
    }
  } catch (err) {
    console.warn('[SPED Fiscal] supplier cMun from nfeInbox failed:', err.message);
  }
}

async function getSuppliers() {
  try {
    const { rows } = await pool.query(`
      SELECT
        s.supplier_id::text AS codigo,
        COALESCE(s.name, '') AS nome,
        s.tax_id AS documento,
        s.state_registration AS ie,
        -- Fornecedor não guarda o código IBGE: resolve pela cidade/UF.
        COALESCE(il.ibge_code::text, '') AS cod_mun,
        COALESCE(s.address_street, s.address, '') AS endereco,
        s.address_number AS numero,
        s.address_complement AS complemento,
        s.address_district AS bairro,
        s.city,
        s.state,
        ''::text AS suframa
      FROM suppliers s
${ibgeByCityLateral('s.city', 's.state', 'il')}
      ORDER BY COALESCE(s.name, ''), s.supplier_id
    `);

    const suppliers = rows.map(row => normalizeParticipant(row, 'supplier'));
    await fillSupplierMunicipalityFromXml(suppliers);
    return suppliers;
  } catch (err) {
    console.error('[SPED Fiscal] getSuppliers participants error:', err.message);
    return [];
  }
}

async function getTransporters() {
  try {
    const { rows } = await pool.query(`
      SELECT
        COALESCE(t.code, t.id::text) AS codigo,
        COALESCE(t.trade_name, t.corporate_name, '') AS nome,
        COALESCE(t.cnpj, t.cpf, '') AS documento,
        t.state_registration AS ie,
        COALESCE(NULLIF(t.city_ibge_code::text, ''), il.ibge_code::text, '') AS cod_mun,
        t.address AS endereco,
        t.address_number AS numero,
        t.address_complement AS complemento,
        t.district AS bairro,
        t.city,
        t.state,
        ''::text AS suframa
      FROM transporters t
      ${ibgeByCityLateral('t.city', 't.state', 'il')}
      WHERE COALESCE(t.is_active, true) = true
      ORDER BY COALESCE(t.trade_name, t.corporate_name), t.id
    `);

    return rows.map(row => normalizeParticipant(row, 'transporter'));
  } catch (err) {
    console.error('[SPED Fiscal] getTransporters participants error:', err.message);
    return [];
  }
}

export async function getParticipantsSource() {
  const [customers, suppliers, transporters] = await Promise.all([
    getCustomers(),
    getSuppliers(),
    getTransporters()
  ]);

  const map = new Map();

  for (const item of [...customers, ...suppliers, ...transporters]) {
    if (!item.codigo) continue;
    map.set(`${item.tipo}:${item.codigo}`, item);
  }

  const participants = [...map.values()];

  console.log('[SPED Fiscal] participants rows:', participants.length);

  return participants;
}

export default {
  getParticipantsSource
};
