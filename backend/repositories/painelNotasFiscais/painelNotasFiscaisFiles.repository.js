// ╔══════════════════════════════════════════════════════════════════════╗
// ║ painelNotasFiscaisFiles.repository.js — Leitura de XMLs/PDFs locais  ║
// ║ Diretórios: public/painelNotasFiscais/{xmlAntigasBh3,pdf}            ║
// ╚══════════════════════════════════════════════════════════════════════╝

import fs from 'node:fs';
import path from 'node:path';
import { XML_DIR, PDF_DIR } from './painelNotasFiscais.constants.js';
import { ensureDir, publicXmlUrl, publicPdfUrl, log } from './painelNotasFiscais.utils.js';
import { extrairCampos } from './painelNotasFiscais.mappers.js';

// ───────────────────────────────────────────────────────────────────────────
// XMLs locais
export function listXmlFiles() {
  ensureDir(XML_DIR);
  const files = fs.readdirSync(XML_DIR).filter((f) => f.toLowerCase().endsWith('.xml'));
  return files;
}

// Cache por arquivo (nome + mtime + tamanho): o painel lê ~4 mil XMLs a cada
// busca/página; só relê do disco o XML novo ou alterado.
const xmlCache = new Map();

function buildXmlItem(fileName, abs, stat) {
  const xml = fs.readFileSync(abs, 'utf8');
  const meta = extrairCampos(xml);

  return {
    nome: fileName,
    caminho: publicXmlUrl(fileName),
    mtime: stat.mtime.toISOString(),
    mtimeMs: stat.mtimeMs,
    tamanhoBytes: stat.size,
    ...meta,
  };
}

export function readXmlItem(fileName) {
  const abs = path.join(XML_DIR, fileName);
  const stat = fs.statSync(abs);
  const cached = xmlCache.get(fileName);

  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return { ...cached.item };
  }

  const item = buildXmlItem(fileName, abs, stat);
  xmlCache.set(fileName, { mtimeMs: stat.mtimeMs, size: stat.size, item });
  return { ...item };
}

export function listAllXmlItems() {
  const files = listXmlFiles();
  const present = new Set(files);

  for (const name of xmlCache.keys()) {
    if (!present.has(name)) xmlCache.delete(name);
  }

  const items = [];
  for (const fileName of files) {
    try {
      items.push(readXmlItem(fileName));
    } catch (err) {
      // Um arquivo removido/ilegível no meio da leitura não derruba a lista
      log('Falha ao ler XML:', fileName, err.message);
    }
  }
  return items;
}

// ───────────────────────────────────────────────────────────────────────────
// PDFs locais
export function listPdfFiles() {
  ensureDir(PDF_DIR);
  const files = fs.readdirSync(PDF_DIR).filter((f) => f.toLowerCase().endsWith('.pdf'));
  return files.map((nome) => {
    const abs = path.join(PDF_DIR, nome);
    const stat = fs.statSync(abs);

    return {
      nome,
      caminho: publicPdfUrl(nome),
      mtime: stat.mtime.toISOString(),
      mtimeMs: stat.mtimeMs,
      tamanhoBytes: stat.size,
    };
  });
}
