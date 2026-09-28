// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfes.constants.js — Tabelas e flag de debug da listagem de NF-e      ║
// ╚══════════════════════════════════════════════════════════════════════╝

// Carregado antes de ler process.env: tecnoSpeedNfeApi.js roda dotenv.config()
// (no original ele era o primeiro import, antes de LIST_DEBUG ser avaliado).
import '../../services/apis/tecnoSpeedNfeApi.js';

export const TB_ORDERS = 'public."orders"';
export const TB_ORDER_ITEMS = 'public."order_items"';
export const TB_CUSTOMERS = 'public."customers"';

// Flag de debug opcional (liga com NFE_LIST_DEBUG=1 no .env)
export const LIST_DEBUG =
  process.env.NFE_LIST_DEBUG === '1' || process.env.NFE_LIST_DEBUG === 'true';
