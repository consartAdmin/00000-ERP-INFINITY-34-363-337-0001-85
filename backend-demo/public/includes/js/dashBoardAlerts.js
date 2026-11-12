/* ╔══════════════════════════════════════════════════════════════════════╗
 * ║ dashBoardAlerts.js — Alertas Dashboard                              ║
 * ║ CONSART ERP                                                         ║
 * ║                                                                      ║
 * ║ - E-mail                                                             ║
 * ║ - NF-e                                                               ║
 * ║ - Pedidos sem NF-e                                                   ║
 * ║ - Better Date To Buy                                                 ║
 * ║ - Estoque Crítico                                                    ║
 * ╚══════════════════════════════════════════════════════════════════════╝ */

console.log('🔵 dashBoardAlerts.js carregado');


// ─────────────────────────────────────────────────────────────
// APIs
// ─────────────────────────────────────────────────────────────
const DASH_ALERTS_API =
  '/api/dashboard/alerts';

const ORDERS_PENDING_NFE_API =
  '/api/orders/pending-nfe';

const BETTER_DATE_API =
  '/api/betterDateToBuy/today-alerts';

const STOCK_ALERTS_API =
  '/api/dashboard/stock-alerts';


// ─────────────────────────────────────────────────────────────
// LINKS
// ─────────────────────────────────────────────────────────────
const ORDERS_PAGE_URL =
  '/public/orders/orders.html';

const BETTER_DATE_PAGE_URL =
  '/betterDateToBuy/betterDateToBuy.html?situacao=due';

// Aviso "clientes para contatar" uma vez por dia (por navegador/usuário)
const BETTER_DATE_NOTICE_KEY =
  'consart:betterDateToBuy:notice';

const STOCK_PAGE_URL =
  '/public/productsStock/productsStock.html';


// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
const moneyBRAlerts =
  typeof moneyBR === 'function'
    ? moneyBR
    : (v) =>
      'R$ ' +
      Number(v || 0)
        .toFixed(2)
        .replace('.', ',')
        .replace(
          /\B(?=(\d{3})+(?!\d))/g,
          '.'
        );

async function safeJson(url) {
  try {
    const res = await fetch(
      url,
      { cache: 'no-store' }
    );

    if (!res.ok) {
      throw new Error(
        `${url} → ${res.status}`
      );
    }

    return await res.json();

  } catch (err) {
    console.warn(
      '[dashBoardAlerts]',
      err
    );

    return null;
  }
}


// ─────────────────────────────────────────────────────────────
// ELEMENT REFERENCES
// ─────────────────────────────────────────────────────────────
let alertEmailCard;
let alertEmailCount;
let alertEmailStatus;

let alertNfeCard;
let alertNfeCount;
let alertNfeStatus;

let alertBudgetsOrdersCard;
let alertBudgetsOrdersCount;
let alertBudgetsOrdersStatus;

let alertBetterDateCard;
let alertBetterDateCount;
let alertBetterDateStatus;

let alertStockCard;
let alertStockCount;
let alertStockStatus;


// ─────────────────────────────────────────────────────────────
// INIT ELEMENTS
// ─────────────────────────────────────────────────────────────
function initElements() {
  // EMAIL
  alertEmailCard =
    document.getElementById(
      'alert-email'
    );

  alertEmailCount =
    document.getElementById(
      'alert-email-count'
    );

  alertEmailStatus =
    alertEmailCard?.querySelector(
      '.dashboard-alert-status'
    );


  // NFE
  alertNfeCard =
    document.getElementById(
      'alert-nfe'
    );

  alertNfeCount =
    document.getElementById(
      'alert-nfe-count'
    );

  alertNfeStatus =
    alertNfeCard?.querySelector(
      '.dashboard-alert-status'
    );


  // ORDERS
  alertBudgetsOrdersCard =
    document.getElementById(
      'alert-budgets-orders'
    );

  alertBudgetsOrdersCount =
    document.getElementById(
      'alert-budgets-orders-count'
    );

  alertBudgetsOrdersStatus =
    alertBudgetsOrdersCard?.querySelector(
      '.dashboard-alert-status'
    );


  // BETTER DATE
  alertBetterDateCard =
    document.getElementById(
      'alert-better-date'
    );

  alertBetterDateCount =
    document.getElementById(
      'alert-better-date-count'
    );

  alertBetterDateStatus =
    alertBetterDateCard?.querySelector(
      '.dashboard-alert-status'
    );


  // STOCK
  alertStockCard =
    document.getElementById(
      'alert-stock'
    );

  alertStockCount =
    document.getElementById(
      'alert-stock-count'
    );

  alertStockStatus =
    document.getElementById(
      'alert-stock-status'
    );


  bindNavigation();
}


// ─────────────────────────────────────────────────────────────
// CLICK NAVIGATION
// ─────────────────────────────────────────────────────────────
function bindNavigation() {
  if (alertEmailCard) {
    alertEmailCard.addEventListener(
      'click',
      () => {
        window.location.href =
          '/public/emailInbox/emailInbox.html';
      }
    );
  }

  if (alertNfeCard) {
    alertNfeCard.addEventListener(
      'click',
      () => {
        window.location.href =
          '/public/nfeInbox/nfeInbox.html';
      }
    );
  }

  if (alertBudgetsOrdersCard) {
    alertBudgetsOrdersCard.addEventListener(
      'click',
      () => {
        window.location.href =
          ORDERS_PAGE_URL;
      }
    );
  }

  if (alertBetterDateCard) {
    alertBetterDateCard.addEventListener(
      'click',
      () => {
        window.location.href =
          BETTER_DATE_PAGE_URL;
      }
    );

    alertBetterDateCard.addEventListener(
      'keydown',
      (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          window.location.href =
            BETTER_DATE_PAGE_URL;
        }
      }
    );
  }

  if (alertStockCard) {
    alertStockCard.addEventListener(
      'click',
      () => {
        window.location.href =
          STOCK_PAGE_URL;
      }
    );
  }
}


// ─────────────────────────────────────────────────────────────
// UPDATE EMAIL + NFE
// ─────────────────────────────────────────────────────────────
async function updateMainAlerts() {
  const data =
    await safeJson(
      DASH_ALERTS_API
    );

  if (!data?.ok) return;

  // EMAIL
  const unread =
    Number(
      data.email?.unreadCount
      || 0
    );

  if (alertEmailCount) {
    alertEmailCount.textContent =
      unread;
  }

  if (alertEmailStatus) {
    alertEmailStatus.textContent =
      unread > 0
        ? `${unread} mensagem(ns)`
        : 'Nenhuma nova mensagem';
  }

  alertEmailCard?.classList.toggle(
    'is-active',
    unread > 0
  );


  // NFE
  const nfe =
    Number(
      data.nfe?.newCount
      || 0
    );

  if (alertNfeCount) {
    alertNfeCount.textContent =
      nfe;
  }

  if (alertNfeStatus) {
    alertNfeStatus.textContent =
      nfe > 0
        ? `${nfe} nota(s) nova(s)`
        : 'Nenhuma nota nova';
  }

  alertNfeCard?.classList.toggle(
    'is-active',
    nfe > 0
  );
}


// ─────────────────────────────────────────────────────────────
// UPDATE PENDING ORDERS
// ─────────────────────────────────────────────────────────────
async function updateOrdersAlert() {
  const data =
    await safeJson(
      ORDERS_PENDING_NFE_API
    );

  if (!data?.ok) return;

  const count =
    Number(
      data.count || 0
    );

  const total =
    Number(
      data.totalAmount || 0
    );

  if (alertBudgetsOrdersCount) {
    alertBudgetsOrdersCount.textContent =
      count;
  }

  if (alertBudgetsOrdersStatus) {
    alertBudgetsOrdersStatus.textContent =
      count > 0
        ? `${count} pedido(s) | ${moneyBRAlerts(total)}`
        : 'Nenhum pedido pendente';
  }

  alertBudgetsOrdersCard?.classList.toggle(
    'is-active',
    count > 0
  );
}


// ─────────────────────────────────────────────────────────────
// UPDATE BETTER DATE ALERT
// ─────────────────────────────────────────────────────────────
async function updateBetterDateAlert() {
  const data =
    await safeJson(
      BETTER_DATE_API
    );

  // A API devolve { ok, count, data: [...] }
  const rows =
    Array.isArray(data) ? data : data?.data;

  if (!Array.isArray(rows)) return;

  const count =
    rows.length;

  if (alertBetterDateCount) {
    alertBetterDateCount.textContent =
      count;
  }

  if (alertBetterDateStatus) {
    alertBetterDateStatus.textContent =
      count > 0
        ? `${count} cliente(s) no dia de recompra`
        : 'Nenhum cliente para contatar hoje';
  }

  alertBetterDateCard?.classList.toggle(
    'is-active',
    count > 0
  );

  if (alertBetterDateCard && count > 0) {
    showBetterDateNotice(rows);
  }
}


// ─────────────────────────────────────────────────────────────
// AVISO AO ENTRAR (1x por dia): lista quem contatar
// ─────────────────────────────────────────────────────────────
let betterDateNoticeOpen = false;

async function showBetterDateNotice(rows) {
  const today =
    new Date().toLocaleDateString('sv-SE');

  const userKey =
    localStorage.getItem('user_id') ||
    localStorage.getItem('username') ||
    '';

  const key =
    `${BETTER_DATE_NOTICE_KEY}:${userKey}`;

  if (betterDateNoticeOpen || localStorage.getItem(key) === today) return;

  betterDateNoticeOpen = true;
  localStorage.setItem(key, today);

  try {
    const { showCenterModal } =
      await import('/public/includes/js/centerAlertModal.js');

    // centerAlertModal usa innerHTML: escapa os nomes
    const esc = (v) => String(v ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

    const names = rows
      .slice(0, 8)
      .map((row) => `• ${esc(row.trade_name || row.legal_name || `Cliente #${row.customer_id}`)}`);

    if (rows.length > 8) {
      names.push(`• e mais ${rows.length - 8}`);
    }

    const button = await showCenterModal({
      variant: 'warning',
      title: 'Clientes para contatar',
      message:
        `Chegou o dia de recompra de ${rows.length} cliente(s):<br><br>${names.join('<br>')}`,
      timeoutMs: null,
      buttons: [
        { label: 'Depois', variant: 'cancel' },
        { label: 'Abrir lista', variant: 'confirm' }
      ]
    });

    if (String(button?.variant || '').toLowerCase() === 'confirm') {
      window.location.href =
        BETTER_DATE_PAGE_URL;
    }
  } catch (err) {
    console.warn('[dashBoardAlerts] aviso Melhor Data de Compra', err);
  } finally {
    betterDateNoticeOpen = false;
  }
}


// ─────────────────────────────────────────────────────────────
// UPDATE STOCK ALERT
// ─────────────────────────────────────────────────────────────
async function updateStockAlert() {
  const data =
    await safeJson(
      STOCK_ALERTS_API
    );

  if (!data?.ok) return;

  const count =
    Number(
      data.count || 0
    );

  if (alertStockCount) {
    alertStockCount.textContent =
      count;
  }

  if (alertStockStatus) {
    alertStockStatus.textContent =
      count > 0
        ? `${count} produto(s) abaixo do mínimo`
        : 'Nenhum produto abaixo do mínimo';
  }

  alertStockCard?.classList.toggle(
    'is-active',
    count > 0
  );
}


// ─────────────────────────────────────────────────────────────
// MAIN UPDATE
// ─────────────────────────────────────────────────────────────
async function atualizarDashBoardAlerts() {
  await Promise.all([
    updateMainAlerts(),
    updateOrdersAlert(),
    updateBetterDateAlert(),
    updateStockAlert()
  ]);
}

window.addEventListener('focus', atualizarDashBoardAlerts);

window.addEventListener('pageshow', atualizarDashBoardAlerts);

window.addEventListener('email:updated', atualizarDashBoardAlerts);

window.addEventListener('storage', (ev) => {
  if (ev.key === 'consart_email_alert_refresh') {
    atualizarDashBoardAlerts();
  }
});


// ─────────────────────────────────────────────────────────────
// BOOTSTRAP
// ─────────────────────────────────────────────────────────────
document.addEventListener(
  'DOMContentLoaded',
  () => {
    initElements();

    atualizarDashBoardAlerts();

    setInterval(
      atualizarDashBoardAlerts,
      30000
    );
  }
);