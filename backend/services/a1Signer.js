// ╔══════════════════════════════════════════════════════════════════════════════════╗
// ║ backend/services/a1Signer.js – mTLS (A1) e assinatura XML da NF-e (com logs)    ║
/* ╚══════════════════════════════════════════════════════════════════════════════════╝ */

import https from "node:https";
import fs from "node:fs/promises";
import * as fsSync from "node:fs";
import path from "node:path";
import { Storage } from "@google-cloud/storage";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const forge = require("node-forge");
const { SignedXml } = require("xml-crypto");

/* ───────── Logger ───────── */
function logInfo(msg, extra = {}) {
  console.log("[A1Signer][INFO]", msg, extra);
}
function logError(msg, extra = {}) {
  console.error("[A1Signer][ERROR]", msg, extra);
}

/* ───────── Helpers ───────── */
function getenvAny(keys, def = "") {
  for (const k of keys) {
    const v = process.env[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return def;
}
async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

/* ───────── Carregar PFX (3 fontes: path, base64, GCS) ───────── */
async function loadPfx(opts = {}) {
  try {
    const pfxPath   = opts.pfxPath   || getenvAny(["NFE_A1_PFX_PATH",   "NFE_CERT_PATH"  ], "");
    const pfxBase64 = opts.pfxBase64 || getenvAny(["NFE_A1_PFX_B64",    "NFE_CERT_B64"   ], "");
    const gcsBucket = opts.gcsBucket || getenvAny(["NFE_A1_GCS_BUCKET", "NFE_CERT_BUCKET"], "");
    const gcsObject = opts.gcsObject || getenvAny(["NFE_A1_GCS_OBJECT", "NFE_CERT_OBJECT"], "");

    if (pfxPath) {
      const abs = path.isAbsolute(pfxPath) ? pfxPath : path.resolve(process.cwd(), pfxPath);
      if (await fileExists(abs)) {
        logInfo("Carregando PFX via path", { abs });
        return fs.readFile(abs);
      }
    }
    if (pfxBase64) {
      logInfo("Carregando PFX via Base64 em variável de ambiente");
      return Buffer.from(pfxBase64, "base64");
    }
    if (gcsBucket && gcsObject) {
      logInfo("Carregando PFX via Google Cloud Storage", { gcsBucket, gcsObject });
      const storage = new Storage();
      const [buf] = await storage.bucket(gcsBucket).file(gcsObject).download();
      return buf;
    }

    throw new Error("Certificado A1 não encontrado (PFX path, Base64 ou GCS).");
  } catch (err) {
    logError("Falha ao carregar PFX", { message: err.message, stack: err.stack });
    throw err;
  }
}

/* ───────── Extrair chave/cert do PFX (PEM) ───────── */
function pfxToPem(pfxBuffer, passphrase = "") {
  try {
    logInfo("Iniciando extração de chave/cert do PFX");
    const bytes = forge.util.createBuffer(pfxBuffer).getBytes();
    const asn1  = forge.asn1.fromDer(bytes, false);
    const pass  = (passphrase || "").replace(/\r?\n/g, "").trim();

    const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, pass);

    const keyBags  =
      p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ||
      p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [];
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];

    if (!keyBags.length)  throw new Error("Chave privada não encontrada no PFX.");
    if (!certBags.length) throw new Error("Certificado não encontrado no PFX.");

    logInfo("Extração bem-sucedida do PFX", { hasKey: !!keyBags.length, hasCert: !!certBags.length });

    const privateKeyPem  = forge.pki.privateKeyToPem(keyBags[0].key);
    const certificatePem = forge.pki.certificateToPem(certBags[0].cert);
    const chain          = certBags.map(b => forge.pki.certificateToPem(b.cert));

    return { privateKeyPem, certificatePem, chain };
  } catch (err) {
    logError("Falha ao extrair chave/cert do PFX", { message: err.message });
    throw err;
  }
}

/* ───────── Cache de agentes por host ───────── */
const AGENT_CACHE = new Map();

export async function createA1AgentForHost(host, opts = {}) {
  try {
    if (!host) throw new Error("Host obrigatório em createA1AgentForHost(host).");
    if (AGENT_CACHE.has(host)) {
      logInfo("Reutilizando agent HTTPS do cache", { host });
      return AGENT_CACHE.get(host);
    }

    const pfx = await loadPfx(opts);
    const passphrase = (
      opts.passphrase ??
      getenvAny(["NFE_A1_PASSPHRASE", "NFE_CERT_PASSPHRASE", "NFE_CERT_PFX_PASS"], "")
    ).replace(/\r?\n/g, "").trim();

    const agent = new https.Agent({
      keepAlive: true,
      pfx,
      passphrase,
      servername: host,          // SNI fixo
      rejectUnauthorized: true,
      maxSockets: 50,
    });

    logInfo("Criado novo agent HTTPS para host", { host });
    AGENT_CACHE.set(host, agent);
    return agent;
  } catch (err) {
    logError("Falha ao criar https.Agent", { host, message: err.message });
    throw err;
  }
}

export function clearAgentsCache() {
  logInfo("Limpando cache de agentes");
  AGENT_CACHE.clear();
}
export function getAgentFromCache(host) {
  const agent = AGENT_CACHE.get(host) || null;
  logInfo("Buscando agent do cache", { host, found: !!agent });
  return agent;
}

/* ───────── Agent genérico a partir do PFX (sem host fixo/SNI dinâmico) ───────── */
export async function createA1AgentFromGCS(opts = {}) {
  // carrega PFX (path/base64/GCS) com as mesmas regras do loadPfx()
  const pfx = await loadPfx(opts);
  const passphrase = (
    opts.passphrase ??
    getenvAny(["NFE_A1_PASSPHRASE", "NFE_CERT_PASSPHRASE", "NFE_CERT_PFX_PASS"], "")
  ).replace(/\r?\n/g, "").trim();

  const agent = new https.Agent({
    keepAlive: true,
    pfx,
    passphrase,
    // sem "servername": SNI será definido pela request de acordo com o host do endpoint
    rejectUnauthorized: true,
    maxSockets: 50,
  });

  logInfo("Criado agent HTTPS genérico via PFX (SNI dinâmico)");
  return agent;
}

/* ───────── Assinatura XML NF-e (nó infNFe) ───────── */
export async function signNFeXml(xml, opts = {}) {
  try {
    if (!xml || typeof xml !== "string") throw new Error("XML inválido para assinatura.");

    logInfo("Iniciando assinatura do XML NF-e");

    const pfxBuf = await loadPfx(opts);
    const passphrase = (
      opts.passphrase ??
      getenvAny(["NFE_A1_PASSPHRASE", "NFE_CERT_PASSPHRASE", "NFE_CERT_PFX_PASS"], "")
    ).replace(/\r?\n/g, "").trim();

    const { privateKeyPem, certificatePem } = pfxToPem(pfxBuf, passphrase);

    if (!privateKeyPem || !privateKeyPem.includes("PRIVATE KEY")) {
      throw new Error("Falha ao extrair chave privada do PFX.");
    }

    const sig = new SignedXml({
      canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
      signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    });

    sig.signingKey = privateKeyPem;

    sig.keyInfoProvider = {
      getKeyInfo() {
        const x509 = certificatePem
          .replace(/-----BEGIN CERTIFICATE-----/g, "")
          .replace(/-----END CERTIFICATE-----/g, "")
          .replace(/\r?\n/g, "");
        return `<X509Data><X509Certificate>${x509}</X509Certificate></X509Data>`;
      },
    };

    const XPATH_INF_NFE =
      "//*[local-name(.)='infNFe' and namespace-uri()='http://www.portalfiscal.inf.br/nfe']";
    const TRANSFORMS = [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/2001/10/xml-exc-c14n#",
    ];
    const DIGEST = "http://www.w3.org/2001/04/xmlenc#sha256";

    try {
      sig.addReference({ xpath: XPATH_INF_NFE, transforms: TRANSFORMS, digestAlgorithm: DIGEST });
    } catch {
      // xml-crypto versões mais antigas usam assinatura diferente de addReference
      sig.addReference(XPATH_INF_NFE, TRANSFORMS, DIGEST);
    }

    sig.computeSignature(xml, {
      location: { reference: "//*[local-name(.)='NFe']", action: "append" },
    });

    logInfo("Assinatura concluída com sucesso");
    return sig.getSignedXml();
  } catch (err) {
    logError("Erro ao assinar XML da NF-e", { message: err.message, stack: err.stack });
    throw err;
  }
}

/* ───────── Default export (compat) ───────── */
export default {
  createA1AgentForHost,
  createA1AgentFromGCS,
  getAgentFromCache,
  clearAgentsCache,
  signNFeXml,
};
