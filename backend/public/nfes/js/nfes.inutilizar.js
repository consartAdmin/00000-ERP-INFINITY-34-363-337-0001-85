// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: nfes.inutilizar.js                                             ║
// ║ MODULE: NF-es Inutilização                                           ║
// ║ CONSART ERP                                                          ║
// ║ Fluxo de inutilização da numeração                                   ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { ROUTES } from './nfes.config.js';
import { fetchNfes } from './nfes.init.js';

export function openModalInutilizarNfe(prefill = {}) {
  const serie = Number(prefill.serie ?? 1);
  const numeroIni = Number(prefill.numeroIni ?? 0);
  const numeroFim = Number(prefill.numeroFim ?? 0);
  const justificativa = String(prefill.justificativa ?? '').trim();
  const ambiente = String(prefill.ambiente ?? 'prod').trim();

  const s = prompt('Série da NF-e para inutilização:', String(serie));
  if (s === null) return;

  const ni = prompt('Número inicial:', numeroIni > 0 ? String(numeroIni) : '');
  if (ni === null) return;

  const nf = prompt('Número final:', numeroFim > 0 ? String(numeroFim) : ni);
  if (nf === null) return;

  const j = prompt('Justificativa (mínimo 15 caracteres):', justificativa);
  if (j === null) return;

  const amb = prompt('Ambiente (prod ou hom):', ambiente);
  if (amb === null) return;

  submitInutilizacao({
    serie: Number(s),
    numeroIni: Number(ni),
    numeroFim: Number(nf),
    justificativa: String(j || '').trim(),
    ambiente: String(amb || 'prod').trim().toLowerCase(),
  });
}

export async function submitInutilizacao({ serie, numeroIni, numeroFim, justificativa, ambiente }) {
  if (!serie || serie < 1) {
    alert('Informe a Série (>= 1).');
    return;
  }

  if (!numeroIni || numeroIni < 1 || !numeroFim || numeroFim < 1 || numeroFim < numeroIni) {
    alert('Informe Nº Inicial e Nº Final corretamente.');
    return;
  }

  if (justificativa.length < 15) {
    alert('Justificativa deve ter no mínimo 15 caracteres.');
    return;
  }

  const ok = confirm(
    `Confirmar inutilização da numeração?\n\nSérie: ${serie}\nDe: ${numeroIni}\nAté: ${numeroFim}\nAmbiente: ${ambiente}\n\n⚠️ A inutilização é irreversível.`,
  );
  if (!ok) return;

  try {
    const currentYear = new Date().getFullYear();

    const payload = {
      companyCnpj: window.EMPRESA_CNPJ || window.companyCnpj || '',
      model: '55',
      serie: Number(serie),
      numberStart: Number(numeroIni),
      numberEnd: Number(numeroFim),
      year: currentYear,
      justification: String(justificativa || '').trim(),
      ambiente: String(ambiente || 'prod').trim().toLowerCase(),
    };

    const res = await fetch(ROUTES.inutilizar, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    let json = null;

    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { ok: false, raw: text };
    }

    if (!res.ok || json?.ok === false) {
      console.error('[NFES] inutilizar erro:', json);

      if (isDuplicateInutilizacao(json)) {
        const friendly = extractInutilizacaoDuplicateMessage(json) || extractErrorMessage(json);
        alert(friendly);
        return;
      }

      alert(extractErrorMessage(json) || `Falha na inutilização (HTTP ${res.status}).`);
      return;
    }

    alert(json?.message || 'Inutilização solicitada com sucesso.');
    await fetchNfes();
  } catch (err) {
    console.error('[NFES] inutilizar EXC:', err);
    alert(err?.message || String(err));
  }
}

export function bindModalInutilizarOnce() {
  // Mantido para compatibilidade.
  // A inutilização continua via prompt para não depender de modal HTML extra.
}

export function extractErrorMessage(payload) {
  if (!payload) return 'Erro desconhecido.';
  if (typeof payload === 'string') return payload;

  if (Array.isArray(payload?.errors) && payload.errors.length) {
    return payload.errors.join('\n');
  }

  if (typeof payload?.message === 'string' && payload.message.trim()) {
    return payload.message.trim();
  }

  if (typeof payload?.error === 'string' && payload.error.trim()) {
    return payload.error.trim();
  }

  if (typeof payload?.error?.message === 'string' && payload.error.message.trim()) {
    return payload.error.message.trim();
  }

  if (typeof payload?.error?.data?.current?.mensagem === 'string' && payload.error.data.current.mensagem.trim()) {
    return payload.error.data.current.mensagem.trim();
  }

  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

export function extractInutilizacaoDuplicateMessage(payload) {
  const current = payload?.error?.data?.current;
  if (!current) return '';

  const protocol = current.protocol || 'N/D';
  const status = current.status || 'N/D';
  const cStat = current.cStat || 'N/D';
  const mensagem = current.mensagem || current.message || '';

  return [
    'Esta inutilização já foi realizada anteriormente.',
    `Protocolo: ${protocol}`,
    `Status: ${status}`,
    `cStat: ${cStat}`,
    mensagem ? `Mensagem SEFAZ: ${mensagem}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function isDuplicateInutilizacao(payload) {
  const msg = String(
    payload?.error?.message ||
    payload?.message ||
    '',
  ).toUpperCase();

  return (
    msg.includes('JÁ EXISTE UMA INUTILIZAÇÃO DE NUMERAÇÃO') ||
    msg.includes('JA EXISTE UMA INUTILIZACAO DE NUMERACAO')
  );
}