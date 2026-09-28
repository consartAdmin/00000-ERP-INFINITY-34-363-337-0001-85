// backend/services/utils/emitenteRepo.js
import pool from "../../config/db.js";

const onlyDigits = (s) => String(s ?? "").replace(/\D+/g, "");

/** Monta caminho do PFX quando não estiver no banco */
const envCertPath = () => {
  const { NFE_CERT_BUCKET, NFE_CERT_OBJECT, NFE_CERT_PATH } = process.env;
  if (NFE_CERT_BUCKET && NFE_CERT_OBJECT) return `gs://${NFE_CERT_BUCKET}/${NFE_CERT_OBJECT}`;
  if (NFE_CERT_PATH) return NFE_CERT_PATH; // caminho local opcional
  return null;
};

/**
 * Lê public."empresaFiscal" (id, ativo=true) e retorna o emitente
 * no formato esperado pelo gerador da NFe (inclui enderEmit).
 */
export async function getEmitenteByEmpresaId(empresaId) {
  // --- Diagnóstico: confirma base/schema e existência do registro ---
  // Obs.: try/catch isolado para não mascarar erro real da função.
  try {
    const diag = await pool.query(`
      SELECT current_database() AS db, current_schema() AS schema
    `);
    const meta = diag?.rows?.[0] || {};
    console.info(`[emitenteRepo] DB=${meta.db} SCHEMA=${meta.schema} empresaId=${empresaId}`);
  } catch (e) {
    console.warn("[emitenteRepo] Falha ao ler meta DB/Schema:", e?.message || e);
  }

  const { rows } = await pool.query(
    `SELECT id AS empresa_id, ativo, cnpj, razao_social, nome_fantasia,
            inscricao_estadual, inscricao_municipal, cnae_principal, crt,
            cep, logradouro, numero, complemento, bairro, municipio,
            cod_municipio_ibge, uf, telefone, email, caminho_certificado,
            senha_certificado, cpais, xpais
       FROM public."empresaFiscal"
      WHERE id = $1 AND ativo = true
      LIMIT 1`,
    [empresaId]
  );

  const r = rows[0];

  if (!r) {
    // Mensagem explícita p/ facilitar leitura no Cloud Run
    const msg = `Emitente não encontrado OU inativo (empresa_id=${empresaId}) em public."empresaFiscal"`;
    const tip = "Verifique DATABASE_URL/NOME DO BANCO/SCHEMA e se o registro está com ativo=true.";
    const err = new Error(`${msg}. ${tip}`);
    err.code = "EMITENTE_NOT_FOUND";
    throw err;
  }

  // ---------- Fallbacks para certificado ----------
  const caminhoCert = r.caminho_certificado || envCertPath();
  const senhaCert =
    r.senha_certificado ||
    process.env.NFE_CERT_PASSWORD ||
    process.env.NFE_CERT_PFX_PASS ||
    null;

  // ---------- Validação de mínimos úteis ----------
  const faltantes = [];
  if (!onlyDigits(r.cnpj)) faltantes.push("cnpj");
  if (!String(r.uf || "")) faltantes.push("uf");
  if (!r.cod_municipio_ibge) faltantes.push("cod_municipio_ibge");
  if (!onlyDigits(r.cep)) faltantes.push("cep");
  if (!caminhoCert) faltantes.push("caminho_certificado (DB ou ENV)");
  if (!senhaCert)   faltantes.push("senha_certificado (DB ou ENV)");

  if (faltantes.length) {
    const e = new Error(`Campos obrigatórios ausentes para emissão: ${faltantes.join(", ")}`);
    e.code = "EMITENTE_FIELDS_MISSING";
    e.meta = {
      empresaId,
      hasBucket: !!process.env.NFE_CERT_BUCKET,
      hasObject: !!process.env.NFE_CERT_OBJECT,
    };
    throw e;
  }

  // ---------- Normalização ----------
  const emit = {
    empresa_id: r.empresa_id,

    // Identificação
    CNPJ: onlyDigits(r.cnpj),
    xNome: r.razao_social,
    xFant: r.nome_fantasia || r.razao_social,
    IE: onlyDigits(r.inscricao_estadual) || undefined,
    IM: onlyDigits(r.inscricao_municipal || "") || undefined,
    CNAE: r.cnae_principal || undefined,
    CRT: Number(r.crt ?? 3),

    // Endereço (enderEmit aninhado)
    enderEmit: {
      xLgr: r.logradouro,
      nro: r.numero,
      xCpl: r.complemento || undefined,
      xBairro: r.bairro,
      cMun: String(r.cod_municipio_ibge),
      xMun: r.municipio,
      UF: String(r.uf || "").toUpperCase(),
      CEP: onlyDigits(r.cep),
      cPais: r.cpais ?? "1058",
      xPais: r.xpais ?? "BRASIL",
      fone: onlyDigits(r.telefone || "") || undefined,
    },

    // Compatibilidade (alguns geradores leem flat)
    xLgr: r.logradouro,
    nro: r.numero,
    xCpl: r.complemento || undefined,
    xBairro: r.bairro,
    xMun: r.municipio,
    UF: String(r.uf || "").toUpperCase(),
    CEP: onlyDigits(r.cep),
    cMun: String(r.cod_municipio_ibge),
    fone: onlyDigits(r.telefone || "") || undefined,
    cPais: r.cpais ?? "1058",
    xPais: r.xpais ?? "BRASIL",

    email: r.email || undefined,

    // Certificado A1
    caminho_certificado: caminhoCert,
    senha_certificado: senhaCert,
  };

  return emit;
}

/**
 * Helper de diagnóstico opcional: retorna o bruto da consulta e meta do banco.
 * Útil para expor em uma rota GET /api/_debug/emitente/:id durante troubleshooting.
 */
export async function debugEmitente(empresaId) {
  const meta = await pool.query(`SELECT current_database() AS db, current_schema() AS schema`);
  const rows = await pool.query(
    `SELECT * FROM public."empresaFiscal" WHERE id = $1`,
    [empresaId]
  );
  return { meta: meta.rows?.[0] || {}, total: rows.rowCount, row: rows.rows?.[0] || null };
}

export default { getEmitenteByEmpresaId, debugEmitente };
