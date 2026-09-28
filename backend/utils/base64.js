// ╔══════════════════════════════════════════════════════════════════════╗
// ║ base64.js — Util Base64 (PDF/XML)                                    ║
// ║ Path: backend/utils/base64.js                                        ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import fs from 'node:fs';

export function base64ToBuffer(b64) {
  if (!b64) return Buffer.alloc(0);
  return Buffer.from(String(b64), 'base64');
}

export function writeBase64File(b64, outputPath) {
  const buf = base64ToBuffer(b64);
  fs.writeFileSync(outputPath, buf);
  return outputPath;
}
