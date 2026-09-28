// ╔════════════════════════════════════════════════════════════════════╗
// ║ promoImages.constants.js — Diretórios públicos e logo              ║
// ╚════════════════════════════════════════════════════════════════════╝

import path from 'path';

export const PUBLIC_DIR = path.resolve(process.cwd(), 'backend/public');
export const PROMO_DIR = path.join(PUBLIC_DIR, 'promocoes');
export const LOGO_PATH = path.join(PUBLIC_DIR, 'imagens', 'logo-bh3.png');
