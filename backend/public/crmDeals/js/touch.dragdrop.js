// ╔══════════════════════════════════════════════════════════════════════╗
// ║ touch.dragdrop.js — CRM Deals (CONSART ERP)                         ║
// ║ Arrastar cards no tablet/celular (toque)                             ║
// ║ ✅ Segurar o card ~0,3s e arrastar até a coluna ou a conclusão       ║
// ║ ✅ Reaproveita os handlers de dragover/drop já existentes            ║
// ║ ✅ Rolagem normal continua funcionando (sem segurar = rola a tela)   ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { onDragStart, onDragEnd } from './dragdrop.columns.js';

const HOLD_MS = 300;
const MOVE_TOLERANCE = 10;
const EDGE = 48;
const SCROLL_STEP = 14;
const TARGET_SELECTOR = '#crm-kanban-stages .crm-column__body, .crm-outcome-dropzone';

let pending = null;   // { card, touchId, x, y, timer }
let drag = null;      // { card, touchId, ghost, offsetX, offsetY, over, lastX, lastY, raf }
let suppressClickUntil = 0;

function injectStyles() {
  if (document.getElementById('crm-touch-dnd-style')) return;
  const style = document.createElement('style');
  style.id = 'crm-touch-dnd-style';
  style.textContent = `
    .crm-card { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
    .crm-card--touch-ghost {
      position: fixed; z-index: 99999; pointer-events: none; margin: 0;
      opacity: 0.92; transform: rotate(2deg) scale(1.03);
      box-shadow: 0 12px 28px rgba(15, 23, 42, 0.28);
    }
    body.crm-touch-dragging { overflow: hidden; touch-action: none; }
  `;
  document.head.appendChild(style);
}

function findTouch(list, id) {
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].identifier === id) return list[i];
  }
  return null;
}

function fire(el, type) {
  if (!el) return;
  const ev = new Event(type, { bubbles: false, cancelable: true });
  el.dispatchEvent(ev);
}

function targetAt(x, y) {
  const el = document.elementFromPoint(x, y);
  return el ? el.closest(TARGET_SELECTOR) : null;
}

function cancelPending() {
  if (!pending) return;
  clearTimeout(pending.timer);
  pending = null;
}

/* --------------------------------------------------------------------- */
/* Início do arraste (depois de segurar)                                 */
/* --------------------------------------------------------------------- */

function startDrag() {
  const { card, touchId, x, y } = pending;
  pending = null;

  const rect = card.getBoundingClientRect();
  const ghost = card.cloneNode(true);
  ghost.classList.add('crm-card--touch-ghost');
  ghost.style.width = `${rect.width}px`;
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  document.body.appendChild(ghost);

  drag = {
    card,
    touchId,
    ghost,
    offsetX: x - rect.left,
    offsetY: y - rect.top,
    over: null,
    lastX: x,
    lastY: y,
    raf: 0,
  };

  onDragStart({ currentTarget: card });
  document.body.classList.add('crm-touch-dragging');
  if (navigator.vibrate) navigator.vibrate(15);

  autoScrollLoop();
}

function moveDrag(x, y) {
  drag.lastX = x;
  drag.lastY = y;
  drag.ghost.style.left = `${x - drag.offsetX}px`;
  drag.ghost.style.top = `${y - drag.offsetY}px`;

  const over = targetAt(x, y);
  if (over !== drag.over) {
    fire(drag.over, 'dragleave');
    drag.over = over;
  }
  fire(over, 'dragover');
}

function finishDrag(drop) {
  const d = drag;
  drag = null;
  cancelAnimationFrame(d.raf);
  d.ghost.remove();
  document.body.classList.remove('crm-touch-dragging');

  if (drop && d.over) {
    fire(d.over, 'drop');
  } else {
    fire(d.over, 'dragleave');
  }

  onDragEnd({ currentTarget: d.card });
  suppressClickUntil = Date.now() + 400;
}

/* --------------------------------------------------------------------- */
/* Rolagem automática perto das bordas (kanban e colunas)                */
/* --------------------------------------------------------------------- */

function scrollIfNear(el, x, y) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (el.scrollWidth > el.clientWidth) {
    if (x < r.left + EDGE) el.scrollLeft -= SCROLL_STEP;
    else if (x > r.right - EDGE) el.scrollLeft += SCROLL_STEP;
  }
  if (el.scrollHeight > el.clientHeight && x >= r.left && x <= r.right) {
    if (y < r.top + EDGE) el.scrollTop -= SCROLL_STEP;
    else if (y > r.bottom - EDGE) el.scrollTop += SCROLL_STEP;
  }
}

function autoScrollLoop() {
  if (!drag) return;
  const { lastX: x, lastY: y } = drag;

  scrollIfNear(document.getElementById('crm-kanban'), x, y);
  scrollIfNear(document.getElementById('crm-kanban-stages'), x, y);
  const col = targetAt(x, y);
  if (col && col.classList.contains('crm-column__body')) scrollIfNear(col, x, y);

  if (y < EDGE) window.scrollBy(0, -SCROLL_STEP);
  else if (y > window.innerHeight - EDGE) window.scrollBy(0, SCROLL_STEP);

  drag.raf = requestAnimationFrame(autoScrollLoop);
}

/* --------------------------------------------------------------------- */
/* Eventos de toque                                                      */
/* --------------------------------------------------------------------- */

function onTouchStart(e) {
  if (drag || pending || e.touches.length !== 1) {
    cancelPending();
    return;
  }

  const card = e.target.closest('#crm-kanban-stages .crm-card');
  if (!card) return;
  if (e.target.closest('button, a, input, select, textarea, [data-ignore-card-click]')) return;

  const t = e.changedTouches[0];
  pending = {
    card,
    touchId: t.identifier,
    x: t.clientX,
    y: t.clientY,
    timer: setTimeout(startDrag, HOLD_MS),
  };
}

function onTouchMove(e) {
  if (pending) {
    const t = findTouch(e.changedTouches, pending.touchId);
    if (t && (Math.abs(t.clientX - pending.x) > MOVE_TOLERANCE
      || Math.abs(t.clientY - pending.y) > MOVE_TOLERANCE)) {
      cancelPending(); // é rolagem, não arraste
    }
    return;
  }

  if (!drag) return;
  const t = findTouch(e.changedTouches, drag.touchId);
  if (!t) return;
  e.preventDefault();
  moveDrag(t.clientX, t.clientY);
}

function onTouchEnd(e) {
  if (pending) {
    cancelPending();
    return;
  }
  if (!drag) return;
  if (!findTouch(e.changedTouches, drag.touchId)) return;
  e.preventDefault();
  finishDrag(e.type === 'touchend');
}

export function initTouchDragDrop() {
  if (window.__crmTouchDnd) return;
  window.__crmTouchDnd = true;

  injectStyles();

  document.addEventListener('touchstart', onTouchStart, { passive: true });
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('touchend', onTouchEnd, { passive: false });
  document.addEventListener('touchcancel', onTouchEnd, { passive: false });

  // Depois de soltar, não abre o modal do card por engano
  document.addEventListener('click', (e) => {
    if (Date.now() < suppressClickUntil && e.target.closest('.crm-card')) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);

  // Menu de contexto do segurar (Android) não atrapalha o arraste
  document.addEventListener('contextmenu', (e) => {
    if ((pending || drag) && e.target.closest('.crm-card')) e.preventDefault();
  });

  // Arraste nativo: se o do toque já começou, evita dois arrastes juntos
  document.addEventListener('dragstart', (e) => {
    if (drag) {
      e.preventDefault();
      return;
    }
    cancelPending();
  }, true);
}
