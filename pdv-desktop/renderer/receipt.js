// ╔══════════════════════════════════════════════════════════════════════╗
// ║ receipt.js — Cupom 80 mm e resumo de fechamento (HTML para impressão)║
// ╚══════════════════════════════════════════════════════════════════════╝

function receiptMoney(v) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function receiptEsc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const RECEIPT_CSS = `
  @page { size: 80mm auto; margin: 0 }
  body { width: 72mm; margin: 0 auto; padding: 4mm 0; font-family: 'Courier New', monospace; font-size: 11px; color: #000 }
  h1 { font-size: 14px; text-align: center; margin: 0 }
  .c { text-align: center } .r { text-align: right } .b { font-weight: bold }
  hr { border: none; border-top: 1px dashed #000; margin: 6px 0 }
  table { width: 100%; border-collapse: collapse } td { vertical-align: top; padding: 1px 0 }
  .big { font-size: 15px; font-weight: bold }
`;

function buildReceiptHtml(sale, config) {
  const lines = sale.items.map((it, i) => `
    <tr><td colspan="3">${String(i + 1).padStart(3, '0')} ${receiptEsc(it.product_code)} ${receiptEsc(it.description)}</td></tr>
    <tr><td>${receiptMoney(it.quantity)} ${receiptEsc(it.unit)} x ${receiptMoney(it.unit_price)}</td>
        <td class="r">${it.discount ? '-' + receiptMoney(it.discount) : ''}</td>
        <td class="r">${receiptMoney(it.quantity * it.unit_price - (it.discount || 0))}</td></tr>`).join('');
  const pays = sale.payments.map((p) => `<tr><td>${receiptEsc(p.label || p.method)}</td><td class="r">${receiptMoney(p.amount)}</td></tr>`).join('');
  const when = new Date(sale.sold_at).toLocaleString('pt-BR');

  return `<!doctype html><html><head><meta charset="utf-8"><style>${RECEIPT_CSS}</style></head><body>
    <h1>${receiptEsc(config.storeName || 'BH3 DISTRIBUIDORA')}</h1>
    <div class="c">${receiptEsc(config.storeDoc || '')}</div>
    <hr><div class="c b">CUPOM NÃO FISCAL</div>
    <div class="c">Venda ${receiptEsc(sale.number)} · ${receiptEsc(config.terminal)} · ${when}</div>
    <div class="c">Operador: ${receiptEsc(sale.operator_name)}</div>
    ${sale.customer_doc ? `<div class="c">CPF/CNPJ: ${receiptEsc(sale.customer_doc)}</div>` : ''}
    <hr><table>${lines}</table><hr>
    <table>
      <tr><td>Subtotal</td><td class="r">${receiptMoney(sale.subtotal)}</td></tr>
      ${sale.discount_total ? `<tr><td>Descontos</td><td class="r">-${receiptMoney(sale.discount_total)}</td></tr>` : ''}
      <tr><td class="big">TOTAL R$</td><td class="r big">${receiptMoney(sale.total)}</td></tr>
    </table><hr>
    <table>${pays}<tr><td class="b">Troco</td><td class="r b">${receiptMoney(sale.change)}</td></tr></table>
    <hr><div class="c">Documento sem valor fiscal</div>
    <div class="c">Consart Starter · Consart ERP</div>
  </body></html>`;
}

function buildClosingHtml(summary, counted, config) {
  const rows = Object.keys(summary.expected).map((k) => `
    <tr><td>${receiptEsc(k)}</td><td class="r">${receiptMoney(summary.expected[k])}</td><td class="r">${receiptMoney(counted[k])}</td></tr>`).join('');
  const mov = summary.movements.map((m) => `<tr><td>${receiptEsc(m.movement_type)}</td><td class="r">${receiptMoney(m.amount)}</td></tr>`).join('');
  const s = summary.session;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${RECEIPT_CSS}</style></head><body>
    <h1>FECHAMENTO DE CAIXA</h1>
    <div class="c">${receiptEsc(config.storeName || 'BH3')} · ${receiptEsc(s.terminal)}</div>
    <div class="c">Aberto ${new Date(s.opened_at).toLocaleString('pt-BR')} por ${receiptEsc(s.operator_name)}</div>
    <div class="c">Fechado ${new Date().toLocaleString('pt-BR')}</div><hr>
    <div>Vendas: ${summary.indicators.sales} · Canceladas: ${summary.indicators.canceled}</div>
    <div>Faturamento: R$ ${receiptMoney(summary.indicators.total)}</div><hr>
    <table><tr><td class="b">Forma</td><td class="r b">Sistema</td><td class="r b">Contado</td></tr>${rows}</table><hr>
    <table><tr><td>Fundo de troco</td><td class="r">${receiptMoney(s.opening_amount)}</td></tr>${mov}</table><hr>
    <div class="c">Assinatura: ______________________</div>
  </body></html>`;
}
