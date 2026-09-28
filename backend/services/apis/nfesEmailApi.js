// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfesEmailApi.js — Service de e-mail NF-e (CONSART ERP | ESM)         ║
// ║ - Monta e envia e-mail com DANFE + XML + BOLETO (se existir)         ║
// ║ - Resolve orderId/AR e anexa boleto com prioridade para AR local     ║
// ║ - Prioridade BOLETO:                                                 ║
// ║   1) /public/... (local) → lê do disco e anexa                         ║
// ║   2) URL remota Asaas (PDF) → baixa, valida %PDF e anexa               ║
// ║   3) Sem PDF válido → não quebra envio (best effort)                  ║
// ║ - Fallback: se raw não tem bankSlipPdfUrl, consulta Asaas (getPayment)║
// ║ - Cache (merge) no raw: bankSlipPdfUrl/bankSlipUrl/invoiceUrl + local ║
// ║                                                                      ║
// ║ ✅ FIXES (2026-02-23):                                                ║
// ║  - Nome correto da ponte: public."accountsReceivableAsaas"            ║
// ║  - PATCH/MERGE em raw (não apaga JSON antigo)                         ║
// ║  - getBankSlipInfoFromArId prioriza boleto_pdf_url_local + PDF        ║
// ║  - tryDownloadPdfBuffer checa assinatura %PDF + content-type          ║
// ║  - Se url começa com /public/... anexa lendo do disco (sem axios)     ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function createNfesEmailApi(deps = {}) {
  const {
    pool,
    tecnospeedNfeApi,
    resolvePlugNotasId,
    extractResumoFromConsultarNFe,
    mapPlugNotasStatus,
    getBaseUrl,
    getApiKey,
    sendAndLogEmail,
    resolveAccountsReceivableIdFromOrder,
    getBoletoDownloadInfo, // (arId) => { url, filename, local? }
    getAsaasPayment,       // (asaasPaymentId) => payment (com bankSlipPdfUrl/bankSlipUrl/invoiceUrl)
    logger = console,
  } = deps;

  // -------------------------------
  // Required deps
  // -------------------------------
  if (!pool) throw new Error('[nfesEmailApi] pool é obrigatório');
  if (!tecnospeedNfeApi) throw new Error('[nfesEmailApi] tecnospeedNfeApi é obrigatório');
  if (typeof resolvePlugNotasId !== 'function') throw new Error('[nfesEmailApi] resolvePlugNotasId é obrigatório');
  if (typeof extractResumoFromConsultarNFe !== 'function') throw new Error('[nfesEmailApi] extractResumoFromConsultarNFe é obrigatório');
  if (typeof mapPlugNotasStatus !== 'function') throw new Error('[nfesEmailApi] mapPlugNotasStatus é obrigatório');
  if (typeof getBaseUrl !== 'function') throw new Error('[nfesEmailApi] getBaseUrl é obrigatório');
  if (typeof getApiKey !== 'function') throw new Error('[nfesEmailApi] getApiKey é obrigatório');
  if (typeof sendAndLogEmail !== 'function') throw new Error('[nfesEmailApi] sendAndLogEmail é obrigatório');

  // -------------------------------
  // Constants / paths (ESM)
  // -------------------------------
  const TB_AR_ASAAS = 'public."accountsReceivableAsaas"';

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // Normalmente este arquivo está em backend/services/...
  // Então ../../public -> backend/public
  const PUBLIC_DIR = path.resolve(__dirname, '../../public');

  // -------------------------------
  // Small utils
  // -------------------------------
  const safeKeyStr = (v) => String(v || '').replace(/[^\dA-Za-z_-]/g, '').slice(0, 120);

  const isPublicUrl = (u) => {
    const s = String(u || '').trim();
    return s.startsWith('/public/');
  };

  const publicUrlToAbsPath = (publicUrl) => {
    const u = String(publicUrl || '').trim();
    if (!u.startsWith('/public/')) return null;
    const rel = u.replace(/^\/public\//, '');
    return path.join(PUBLIC_DIR, rel);
  };

  function guessFilenameFromUrl(url, fallback = 'boleto.pdf') {
    try {
      const u = String(url || '').trim();
      if (!u) return fallback;

      // /public/boletos/xyz.pdf
      if (u.startsWith('/public/')) {
        const base = path.basename(u);
        return base || fallback;
      }

      // remota
      const parsed = new URL(u);
      const base = path.basename(parsed.pathname || '');
      return base && base.includes('.') ? base : fallback;
    } catch {
      return fallback;
    }
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  /* ===============================================================
     DB: PATCH/MERGE raw sem apagar JSON antigo
  =============================================================== */
  async function persistAsaasRawForAr(arId, patchObj) {
    try {
      if (!arId) return;
      const patch = JSON.stringify(patchObj || {});
      await pool.query(
        `
        UPDATE ${TB_AR_ASAAS}
           SET raw = COALESCE(raw, '{}'::jsonb) || $2::jsonb,
               updated_at = now()
         WHERE accounts_receivable_id = $1
        `,
        [arId, patch]
      );
    } catch (e) {
      logger.warn('[NFES][EMAIL] persistAsaasRawForAr falhou:', e?.message || e);
    }
  }

  /* ===============================================================
     GET BOLETO INFO FROM BRIDGE (prioriza local + PDF)
  =============================================================== */
  async function getBankSlipInfoFromArId(arId) {
    const { rows } = await pool.query(
      `
      SELECT
        raw->>'boleto_pdf_url_local' AS local_url,
        raw->>'bankSlipPdfUrl'       AS pdf_url,
        raw->>'bankSlipUrl'          AS url,
        raw->>'invoiceUrl'           AS invoice_url,
        raw->>'invoiceNumber'        AS invoice_number,
        asaas_payment_id
      FROM ${TB_AR_ASAAS}
      WHERE accounts_receivable_id = $1
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1
      `,
      [arId]
    );

    const r = rows?.[0] || {};
    const best =
      (r.local_url && String(r.local_url).trim()) ||
      (r.pdf_url && String(r.pdf_url).trim()) ||
      (r.url && String(r.url).trim()) ||
      (r.invoice_url && String(r.invoice_url).trim()) ||
      null;

    return {
      url: best,
      local_url: r.local_url || null,
      asaas_payment_id: r.asaas_payment_id || null,
      invoice_number: r.invoice_number || null,
    };
  }

  /* ===============================================================
     READ LOCAL PDF (when url starts with /public/)
  =============================================================== */
  function tryReadLocalPdfBuffer(publicUrl) {
    try {
      const abs = publicUrlToAbsPath(publicUrl);
      if (!abs) return null;
      if (!fs.existsSync(abs)) {
        logger.warn('[NFES][EMAIL] Boleto local não encontrado no disco:', abs);
        return null;
      }
      const buf = fs.readFileSync(abs);
      const signature = buf.slice(0, 4).toString();

      if (signature === '%PDF' && buf.length > 800) {
        return buf;
      }

      logger.warn('[NFES][EMAIL] Arquivo local não parece ser PDF válido:', {
        abs,
        size: buf.length,
        signature,
      });

      return null;
    } catch (e) {
      logger.warn('[NFES][EMAIL] Erro lendo boleto local:', e?.message || e);
      return null;
    }
  }

  /* ===============================================================
     DOWNLOAD PDF VALIDATED (remote)
  =============================================================== */
  async function tryDownloadPdfBuffer(url) {
    if (!url) return null;

    try {
      const resp = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxRedirects: 5,
        validateStatus: (s) => s >= 200 && s < 400,
        headers: {
          Accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.8',
          'Cache-Control': 'no-store',
        },
      });

      const buf = Buffer.from(resp.data || []);
      const signature = buf.slice(0, 4).toString();
      const contentType = String(resp.headers?.['content-type'] || '').toLowerCase();

      if ((signature === '%PDF' || contentType.includes('pdf')) && buf.length > 800) {
        return buf;
      }

      logger.warn('[NFES][EMAIL] Conteúdo remoto não é PDF válido.', {
        url: String(url).slice(0, 240),
        size: buf.length,
        contentType,
        signature,
      });

      return null;
    } catch (e) {
      logger.warn('[NFES][EMAIL] Erro download boleto:', e?.message || e);
      return null;
    }
  }

  /* ===============================================================
     BUILD EMAIL BODY
  =============================================================== */
  function buildEmailBodies({ statusNorm, safeKey, boletoAttachment, boletoUrl }) {
    const boletoLine = boletoAttachment
      ? 'Boleto: anexado.'
      : boletoUrl
        ? `Boleto (link): ${boletoUrl}`
        : 'Boleto: não disponível.';

    const boletoLineHtml = escapeHtml(boletoLine).replaceAll('\n', '<br/>');

    return {
      bodyText:
        `Segue em anexo a NF-e (${statusNorm}).\n` +
        `Chave: ${safeKey}\n` +
        `${boletoLine}\n\nCONSART ERP`,

      bodyHtml:
        `<p>Segue em anexo a NF-e (<b>${escapeHtml(statusNorm)}</b>).</p>
         <p><b>Chave:</b> ${escapeHtml(safeKey)}</p>
         <p><b>${boletoLineHtml}</b></p>
         <p>CONSART ERP</p>`,
    };
  }

  /* ===============================================================
     MAIN SEND
  =============================================================== */
  async function sendNfeEmail({
    idParam,
    to,
    cc,
    bcc,
    subject,
    provider = 'hostinger_smtp',
  }) {
    const plugId = await resolvePlugNotasId(idParam);
    if (!plugId) return { ok: false, error: 'NF-e não encontrada.' };

    const sum = await tecnospeedNfeApi.consultarNFe(plugId);
    const resumo = extractResumoFromConsultarNFe(sum);

    const chave = resumo?.chave || plugId;
    const numero = resumo?.numero;
    const statusNorm = mapPlugNotasStatus(resumo?.status, resumo?.cStat);
    const safeKey = safeKeyStr(chave);

    const baseUrl = getBaseUrl().replace(/\/$/, '');
    const headers = { 'X-API-KEY': getApiKey() };

    const [pdfResp, xmlResp] = await Promise.all([
      axios.get(`${baseUrl}/nfe/${plugId}/pdf`, { responseType: 'arraybuffer', headers }),
      axios.get(`${baseUrl}/nfe/${plugId}/xml`, { responseType: 'arraybuffer', headers }),
    ]);

    const danfeBuf = Buffer.from(pdfResp.data || []);
    const xmlBuf = Buffer.from(xmlResp.data || []);

    let boletoAttachment = null;
    let boletoUrl = null;
    let arId = null;

    // Resolve AR via função injetada
    if (typeof resolveAccountsReceivableIdFromOrder === 'function') {
      try {
        arId = await resolveAccountsReceivableIdFromOrder(idParam);
      } catch (e) {
        logger.warn('[NFES][EMAIL] resolveAccountsReceivableIdFromOrder falhou:', e?.message || e);
      }
    }

    if (arId) {
      let url = null;
      let asaasPaymentId = null;
      let invoiceNumber = null;

      // 1) Prioriza getBoletoDownloadInfo (ele pode retornar /public/... ou URL remota)
      if (typeof getBoletoDownloadInfo === 'function') {
        try {
          const info = await getBoletoDownloadInfo(arId);
          url = info?.url || null;

          // se retornou local, cacheia no raw como boleto_pdf_url_local (merge)
          if (url && isPublicUrl(url)) {
            await persistAsaasRawForAr(arId, { boleto_pdf_url_local: url });
          }
        } catch (e) {
          logger.warn('[NFES][EMAIL] getBoletoDownloadInfo falhou:', e?.message || e);
        }
      }

      // 2) Se ainda não tem, pega da ponte (prioriza local + PDF)
      if (!url) {
        try {
          const infoDb = await getBankSlipInfoFromArId(arId);
          url = infoDb?.url || null;
          asaasPaymentId = infoDb?.asaas_payment_id || null;
          invoiceNumber = infoDb?.invoice_number || null;
        } catch (e) {
          logger.warn('[NFES][EMAIL] getBankSlipInfoFromArId falhou:', e?.message || e);
        }
      }

      // 3) Se não tem URL e tem paymentId, consulta Asaas (read-only) e cacheia campos úteis
      if (!url && asaasPaymentId && typeof getAsaasPayment === 'function') {
        try {
          const pay = await getAsaasPayment(asaasPaymentId);
          url = pay?.bankSlipPdfUrl || pay?.bankSlipUrl || pay?.invoiceUrl || null;

          if (url) {
            await persistAsaasRawForAr(arId, {
              bankSlipPdfUrl: pay?.bankSlipPdfUrl || null,
              bankSlipUrl: pay?.bankSlipUrl || null,
              invoiceUrl: pay?.invoiceUrl || null,
            });
          }
        } catch (e) {
          logger.warn('[NFES][EMAIL] getAsaasPayment falhou:', e?.message || e);
        }
      }

      boletoUrl = url || null;

      // 4) Monta attachment (prioriza local /public/)
      let buf = null;

      if (url && isPublicUrl(url)) {
        buf = tryReadLocalPdfBuffer(url);
      }

      // 5) Se não conseguiu local, tenta download remoto
      if (!buf && url && !isPublicUrl(url)) {
        buf = await tryDownloadPdfBuffer(url);
      }

      // 6) Se conseguiu buf, cria attachment
      if (buf) {
        const baseName =
          invoiceNumber ? `boleto-${invoiceNumber}.pdf` :
          asaasPaymentId ? `boleto-${asaasPaymentId}.pdf` :
          `boleto-${arId}.pdf`;

        boletoAttachment = {
          filename: safeKeyStr(baseName).replace(/_pdf$/i, '.pdf'),
          content: buf,
          contentType: 'application/pdf',
        };
      }
    }

    const { bodyText, bodyHtml } = buildEmailBodies({
      statusNorm,
      safeKey,
      boletoAttachment,
      boletoUrl,
    });

    const attachments = [
      { filename: `DANFE_${safeKey}.pdf`, content: danfeBuf, contentType: 'application/pdf' },
      { filename: `NFE_${safeKey}.xml`, content: xmlBuf, contentType: 'application/xml' },
      ...(boletoAttachment ? [boletoAttachment] : []),
    ];

    const out = await sendAndLogEmail({
      to_address: to,
      cc_address: cc,
      bcc_address: bcc,
      subject: subject || `NF-e ${numero} (${statusNorm}) — ${safeKey}`,
      body_text: bodyText,
      body_html: bodyHtml,
      attachments,
      provider,
    });

    return {
      ok: !!out?.ok,
      boletoAnexado: !!boletoAttachment,
      boletoUrl,
      accountsReceivableId: arId || null,
      nfeKey: safeKey,
      nfeNumero: numero || null,
      status: statusNorm || null,
    };
  }

  return Object.freeze({
    sendNfeEmail,
  });
}

export default { createNfesEmailApi };