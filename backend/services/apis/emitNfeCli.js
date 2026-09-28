// ╔══════════════════════════════════════════════════════════════╗
// ║ emitNfeCli.js — Emissão direta de NF-e via terminal         ║
// ║ Uso: node backend/services/apis/emitNfeCli.js <order_id>    ║
//   # Com debug de itens
//   $env:NFE_DEBUG="1"
//   node backend/services/apis/emitNfeCli.js 70
// ╚══════════════════════════════════════════════════════════════╝

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// 1) Carrega backend/.env ANTES de tudo
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const envPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath });
console.log(`[ENV] Carregado: ${envPath}`);

import { buildNFeFromOrder, emitirNFe } from '../../repositories/tecnoSpeedNfe/tecnoSpeedNfe.index.js';
import * as ordersApi from './ordersApi.js';

async function main() {
  const orderId = process.argv[2];
  if (!orderId) {
    console.log('Uso: node emitNfeCli.js <order_id>');
    process.exit(1);
  }

  console.log(`>>> Emissão NF-e iniciada para order_id=${orderId}`);

  // [1] Carrega o pedido
  const order = await ordersApi.getById(orderId);
  if (!order || order.ok === false) {
    console.error('❌ Pedido não encontrado!', order);
    process.exit(1);
  }
  console.log('✓ Pedido carregado.');

  // [2] Monta a NF-e
  const nfeJson = await buildNFeFromOrder(order);
  console.log('✓ JSON NF-e montado.');

  if (process.env.NFE_DEBUG === '1') {
    console.log('──────── JSON COMPLETO ────────');
    console.log(JSON.stringify(nfeJson, null, 2));
    console.log('────────────────────────────────');
  }

  // [3] Envia para a TecnoSpeed / PlugNotas
  console.log('\nEnviando NF-e...');
  const resp = await emitirNFe(nfeJson);

  console.log('\n🔁 Resposta:');
  console.log(JSON.stringify(resp, null, 2));

  if (!resp.ok) {
    console.error('\n❌ Falha na emissão da NF-e.');
    process.exit(1);
  }

  console.log('\n✅ NF-e enviada com sucesso! 🎉');
}

main().catch((err) => {
  console.error('\n💥 Erro inesperado:', err);
  process.exit(1);
});
