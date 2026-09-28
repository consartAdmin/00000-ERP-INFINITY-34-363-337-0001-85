// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfeJsonWriter.js — Persistência do JSON enviado na emissão (CONSART)  ║
// ║ Path: backend/services/json/nfeJsonWriter.js                          ║
// ║ ✅ ESM • ✅ cria pasta • ✅ log do caminho real                         ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import fs from 'node:fs/promises';
import path from 'node:path';

function toBool(v, def = true) {
  if (v === true || v === false) return v;
  if (v == null) return def;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(s)) return false;
  return def;
}

function slug(s, max = 80) {
  return String(s ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, max);
}

function safeNowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * Salva JSON em: <CWD>/services/json
 * Se você roda "node server.js" dentro de backend, isso vira:
 * backend/services/json
 */
export async function saveNfeJsonToFile(nfe) {
    console.log('[NFE55][JSON][WRITER] FUNCTION CALLED ✅', {
        cwd: process.cwd(),
        hasNumero: !!nfe?.numero,
        hasIdIntegracao: !!nfe?.idIntegracao
    });
    const enabled = toBool(process.env.NFE_SAVE_JSON, true);

    const baseDir = process.cwd(); // ✅ normalmente "...\backend"
    const outDir = path.resolve(baseDir, 'services', 'json');

    if (!enabled) {
        console.log('[NFE55][JSON] skip (NFE_SAVE_JSON=0). outDir=', outDir);
        return { ok: true, skipped: true, outDir };
    }

    if (!nfe || typeof nfe !== 'object') {
        console.warn('[NFE55][JSON] payload inválido (não é objeto).');
        return { ok: false, error: 'payload inválido', outDir };
    }

    await fs.mkdir(outDir, { recursive: true });

    const serie = nfe?.serie ?? 'S';
    const numero = nfe?.numero ?? 'N';
    const idIntegracao = nfe?.idIntegracao ?? 'SEM-ID';
    const stamp = safeNowStamp();

    const filename = [
        'NFE',
        `S${slug(serie, 8)}`,
        `N${slug(numero, 16)}`,
        slug(idIntegracao, 60),
        stamp,
    ].join('_') + '.json';

    const fullpath = path.join(outDir, filename);

    await fs.writeFile(fullpath, JSON.stringify(nfe, null, 2), 'utf8');

    console.log('[NFE55][JSON] ✅ saved:', fullpath);
    return { ok: true, path: fullpath, filename, outDir };
}
