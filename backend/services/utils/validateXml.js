// backend/services/utils/validateXml.js
// Validação XSD opcional e "lazy" (não derruba a app quando o pacote não existe)

import path from "node:path";
import fs from "node:fs/promises";

function getenv(key, def = "") {
  const raw = process.env[key];
  return (raw == null || raw === "") ? def : String(raw).trim();
}

const SCHEMA_DIR_DEFAULT = path.resolve(process.cwd(), "backend", "services", "schemas");
const NFE_SKIP_XSD = getenv("NFE_SKIP_XSD", "0") === "1";

/**
 * Valida um XML contra um XSD (se ambos estiverem disponíveis).
 * - Se `NFE_SKIP_XSD=1`, retorna `true` sem validar.
 * - Se não encontrar o XSD, retorna `true` (não falha a app).
 * - Se o pacote `xsd-schema-validator` não estiver instalado, retorna `true`.
 * - Se houver erro real de validação, lança erro.
 *
 * @param {string} xmlStr            - Conteúdo XML
 * @param {object} [opts]
 * @param {string} [opts.schemaPath] - Caminho do XSD (default: nfe_v4.00.xsd em services/schemas)
 * @param {string} [opts.schemaDir]  - Dir base dos XSDs (default: backend/services/schemas)
 */
export async function validateNFeXml(
  xmlStr,
  { schemaPath, schemaDir = SCHEMA_DIR_DEFAULT } = {}
) {
  if (NFE_SKIP_XSD) return true;

  const xsdPath = schemaPath || path.join(schemaDir, "nfe_v4.00.xsd");

  // 1) Verifica se o XSD existe
  try {
    await fs.access(xsdPath);
  } catch {
    // Sem XSD → não valida (não é erro operacional)
    return true;
  }

  // 2) Tenta importar o validador dinamicamente
  let validator;
  try {
    const mod = await import("xsd-schema-validator"); // só tenta aqui
    validator = mod.default || mod;
  } catch {
    // Pacote não instalado → ignora validação
    return true;
  }

  // 3) Valida
  return new Promise((resolve, reject) => {
    validator.validateXML(xmlStr, xsdPath, (err, result) => {
      if (err) {
        err.message = `Falha no motor de validação XSD: ${err.message || err}`;
        return reject(err);
      }
      if (!result?.valid) {
        const msgs = (result?.errors || []).map(e => e?.message || String(e)).join(" | ");
        return reject(new Error(`NF-e inválida no XSD: ${msgs || "sem detalhes"}`));
      }
      resolve(true);
    });
  });
}
