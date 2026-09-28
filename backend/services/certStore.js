// ╔════════════════════════════════════════════════════════════════════╗
// ║ 🔐 certStore.js – Fonte única do Certificado A1 (.pfx)            ║
// ║   • Lê de GCS (NFE_CERT_BUCKET + NFE_CERT_OBJECT) ou disco (/tmp)  ║
// ║   • Valida com node-forge (opcional)                               ║
// ║   • Cache em memória                                               ║
// ║   • ESM puro                                                       ║
// ╚════════════════════════════════════════════════════════════════════╝

import fs from 'node:fs/promises';
import path from 'node:path';
import forge from 'node-forge';

let Storage = null;
try {
  ({ Storage } = await import('@google-cloud/storage').catch(() => ({})));
} catch { /* noop */ }

let SecretManagerServiceClient = null;
try {
  ({ SecretManagerServiceClient } =
    await import('@google-cloud/secret-manager').catch(() => ({})));
} catch { /* noop */ }

const mem = {
  pfxBuf: null,
  senha: null,
  meta: null, // { emitente, validade, fonte, at }
};

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────
function getCfg() {
  const bucket = process.env.NFE_CERT_BUCKET || process.env.GCS_BUCKET || '';
  const object = process.env.NFE_CERT_OBJECT || '';
  const gcsUri =
    process.env.NFE_CERT_GCS_URI ||
    (bucket && object ? `gs://${bucket}/${object}` : '');
  const certsDir = process.env.CERTS_DIR || '/tmp/certs';

  return {
    bucket,
    object,
    gcsUri,
    certsDir,
    canGcs: !!(bucket && object && Storage),
  };
}

async function readFromGCS(bucket, object) {
  const storage = new Storage();
  const file = storage.bucket(bucket).file(object);
  const [buf] = await file.download();
  return buf;
}

async function readFromDisk(filePath) {
  return fs.readFile(filePath);
}

function parsePfx(buf, senha) {
  const der = buf.toString('binary');
  const asn1 = forge.asn1.fromDer(der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha);
  const bags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const cert = bags[forge.pki.oids.certBag]?.[0]?.cert;
  if (!cert) throw new Error('CERT_NOT_FOUND');

  const emitente = cert.subject.getField('CN')?.value || '(CN indisponível)';
  const validade = cert.validity.notAfter.toISOString().split('T')[0];
  return { emitente, validade };
}

async function fetchPassword() {
  // ordem de prioridade:
  // 1) ENV NFE_CERT_PASSWORD
  // 2) Secret Manager "NFE_CERT_PASSWORD" (última versão)
  if (process.env.NFE_CERT_PASSWORD) return process.env.NFE_CERT_PASSWORD;

  if (!SecretManagerServiceClient) return null;
  const projectId =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.PROJECT_ID;
  if (!projectId) return null;

  const name = `projects/${projectId}/secrets/NFE_CERT_PASSWORD/versions/latest`;
  const client = new SecretManagerServiceClient();
  try {
    const [version] = await client.accessSecretVersion({ name });
    const pwd = version?.payload?.data?.toString('utf8')?.trim() || null;
    return pwd || null;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────
// API pública
// ────────────────────────────────────────────────────────────────────

/**
 * Retorna { pfxBuffer, password, meta:{emitente, validade, fonte, at} }
 * Faz cache em memória; use forceReload=true para recarregar.
 */
export async function getCert({ validate = true, forceReload = false } = {}) {
  if (mem.pfxBuf && mem.senha && !forceReload) {
    return { pfxBuffer: mem.pfxBuf, password: mem.senha, meta: mem.meta };
  }

  const cfg = getCfg();

  // 1) senha
  const senha = await fetchPassword();
  if (!senha) {
    const e = new Error('Senha do certificado não encontrada (NFE_CERT_PASSWORD).');
    e.code = 'NO_PASSWORD';
    throw e;
  }

  // 2) origem (GCS preferencial)
  let pfxBuf;
  let fonte;
  try {
    if (cfg.canGcs) {
      pfxBuf = await readFromGCS(cfg.bucket, cfg.object);
      fonte = `gcs://${cfg.bucket}/${cfg.object}`;
    } else {
      const localPath =
        process.env.NFE_CERT_LOCAL_PATH ||
        path.join(cfg.certsDir, path.basename(cfg.object || 'certificado.pfx'));
      pfxBuf = await readFromDisk(localPath);
      fonte = localPath;
    }
  } catch (err) {
    const e = new Error(
      `Falha ao ler certificado (${cfg.canGcs ? 'GCS' : 'disco'}): ${err.message || err}`
    );
    e.code = 'READ_FAIL';
    throw e;
  }

  // 3) valida
  let meta = { emitente: null, validade: null, fonte, at: new Date().toISOString() };
  if (validate) {
    try {
      const parsed = parsePfx(pfxBuf, senha);
      meta.emitente = parsed.emitente;
      meta.validade = parsed.validade;
    } catch (err) {
      const msg = String(err?.message || err);
      if (msg.includes('Invalid MAC') || msg.includes('password')) {
        const e = new Error('Senha do certificado inválida.');
        e.code = 'BAD_PASSWORD';
        throw e;
      }
      throw err;
    }
  }

  // cache
  mem.pfxBuf = pfxBuf;
  mem.senha = senha;
  mem.meta = meta;

  return { pfxBuffer: pfxBuf, password: senha, meta };
}

/** Limpa o cache (ex.: após trocar o .pfx no bucket). */
export function clearCertCache() {
  mem.pfxBuf = null;
  mem.senha = null;
  mem.meta = null;
}

/** Info rápida da configuração ativa (útil para logs/diagnóstico). */
export function certInfo() {
  const cfg = getCfg();
  return {
    mode: cfg.canGcs ? 'gcs' : 'local',
    bucket: cfg.bucket || null,
    object: cfg.object || null,
    gcsUri: cfg.gcsUri || null,
    certsDir: cfg.certsDir,
    cached: !!mem.pfxBuf,
    meta: mem.meta || null,
  };
}
