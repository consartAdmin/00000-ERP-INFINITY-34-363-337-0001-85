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

function buildReceiptHtml(sale, config, nfceEnabled = false) {
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
    ${nfceEnabled ? `<div class="c b">NFC-e ${sale.nfce?.status && sale.nfce.status !== 'PENDENTE' ? `não autorizada (${receiptEsc(sale.nfce.status)})` : 'pendente'}: será emitida pelo ERP. Reimprima pela tela Vendas.</div>` : ''}
    <div class="c">Consart Starter · Consart ERP</div>
  </body></html>`;
}

const PAY_LABEL = { DINHEIRO: 'Dinheiro', PIX: 'PIX', DEBITO: 'Cartão de Débito', CREDITO: 'Cartão de Crédito', OUTROS: 'Outros' };

function formatKey(key) {
  return String(key || '').replace(/(\d{4})(?=\d)/g, '$1 ');
}

function formatDoc(doc) {
  const d = String(doc || '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return d;
}

/** DANFE NFC-e (80 mm) no leiaute do Manual de Especificações Técnicas do DANFE NFC-e. */
function buildDanfceHtml(sale, nfce, issuer, config) {
  const homolog = nfce.environment !== 'producao';
  const items = sale.items.map((it, i) => `
    <tr><td colspan="4">${String(i + 1).padStart(3, '0')} ${receiptEsc(it.product_code)} ${receiptEsc(it.description)}</td></tr>
    <tr><td></td><td>${receiptMoney(it.quantity)} ${receiptEsc(it.unit)} x ${receiptMoney(it.unit_price)}</td><td class="r">${it.discount ? '-' + receiptMoney(it.discount) : ''}</td>
        <td class="r">${receiptMoney(it.quantity * it.unit_price - (it.discount || 0))}</td></tr>`).join('');
  const qty = sale.items.length;
  const pays = sale.payments.map((p) => `<tr><td>${receiptEsc(PAY_LABEL[p.method] || p.label || p.method)}</td><td class="r">${receiptMoney(p.amount)}</td></tr>`).join('');
  const issued = nfce.issued_at ? new Date(nfce.issued_at).toLocaleString('pt-BR') : new Date(sale.sold_at).toLocaleString('pt-BR');
  const authorized = nfce.authorized_at ? new Date(nfce.authorized_at).toLocaleString('pt-BR') : '';
  const doc = String(sale.customer_doc || '').replace(/\D/g, '');

  return `<!doctype html><html><head><meta charset="utf-8"><style>${RECEIPT_CSS}
    .qr { width: 34mm; height: 34mm; margin: 4px auto } .qr svg { width: 100%; height: 100% }
    .key { font-size: 10px; letter-spacing: .3px } .sm { font-size: 9.5px }</style></head><body>
    <div class="c b">${receiptEsc(issuer.name || config.storeName || '')}</div>
    <div class="c sm">CNPJ: ${receiptEsc(formatDoc(issuer.cnpj))}${issuer.ie ? ` · IE: ${receiptEsc(issuer.ie)}` : ''}</div>
    <div class="c sm">${receiptEsc(issuer.address || '')}${issuer.city ? ` · ${receiptEsc(issuer.city)}` : ''}</div>
    <hr><div class="c b sm">Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica</div>
    ${homolog ? '<div class="c b">EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO – SEM VALOR FISCAL</div>' : ''}
    <hr><table><tr><td class="b">Cód / Descrição</td><td class="b">Qtde Un x Vl Unit</td><td class="r b">Desc</td><td class="r b">Total</td></tr>${items}</table><hr>
    <table>
      <tr><td>Qtde. total de itens</td><td class="r">${qty}</td></tr>
      <tr><td>Valor total R$</td><td class="r">${receiptMoney(sale.subtotal)}</td></tr>
      ${sale.discount_total ? `<tr><td>Descontos R$</td><td class="r">-${receiptMoney(sale.discount_total)}</td></tr>` : ''}
      <tr><td class="big">Valor a pagar R$</td><td class="r big">${receiptMoney(sale.total)}</td></tr>
    </table><hr>
    <table><tr><td class="b">FORMA DE PAGAMENTO</td><td class="r b">VALOR PAGO R$</td></tr>${pays}
      <tr><td>Troco R$</td><td class="r">${receiptMoney(sale.change)}</td></tr></table><hr>
    <div class="c b sm">Consulte pela Chave de Acesso em</div>
    <div class="c sm">${receiptEsc(nfce.url_chave || '')}</div>
    <div class="c key">${receiptEsc(formatKey(nfce.key))}</div><hr>
    <div class="c sm">${doc ? `CONSUMIDOR - ${doc.length === 11 ? 'CPF' : 'CNPJ'} ${receiptEsc(formatDoc(doc))}` : 'CONSUMIDOR NÃO IDENTIFICADO'}</div><hr>
    <div class="c b sm">NFC-e nº ${receiptEsc(String(nfce.number).padStart(9, '0'))} Série ${receiptEsc(String(nfce.series).padStart(3, '0'))} ${receiptEsc(issued)}</div>
    <div class="c sm">Protocolo de autorização: ${receiptEsc(nfce.protocol || '')}</div>
    <div class="c sm">Data de autorização: ${receiptEsc(authorized)}</div>
    <div class="qr">${nfce.qr_svg || ''}</div>
    ${homolog ? '<div class="c b">EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO – SEM VALOR FISCAL</div>' : ''}
    <div class="c sm">Venda ${receiptEsc(sale.number)} · Operador: ${receiptEsc(sale.operator_name)}</div>
    <div class="c sm">Consart Starter · Consart ERP</div>
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
