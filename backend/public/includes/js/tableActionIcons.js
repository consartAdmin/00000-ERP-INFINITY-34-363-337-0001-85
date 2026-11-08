// ╔════════════════════════════════════════════════════════════════════╗
// ║ tableActionIcons.js — troca botões de texto das tabelas por ícones ║
// ║ CONSART ERP | importado pelo core.js                               ║
// ║                                                                    ║
// ║ Botões dentro de <td> cujo texto é só "Editar", "Excluir",         ║
// ║ "Desativar", "Ativar", "Ver"... viram ícones de linha do padrão    ║
// ║ (actionIcons). É o MESMO elemento: data-*, onclick e listeners     ║
// ║ continuam funcionando. O texto vai para o title/aria-label.        ║
// ║ Para manter um botão como texto, use a classe .action-keep.        ║
// ╚════════════════════════════════════════════════════════════════════╝

import { actionIconSvg } from '/public/includes/js/actionIcons.js';

const TEXT_TO_ACTION = Object.freeze({
  editar: 'edit',
  alterar: 'edit',
  excluir: 'delete',
  remover: 'delete',
  apagar: 'delete',
  desativar: 'pause',
  inativar: 'pause',
  ativar: 'play',
  reativar: 'play',
  ver: 'view',
  visualizar: 'view',
  detalhes: 'view',
  copiar: 'copy',
  duplicar: 'copy',
});

const SELECTOR = 'td button:not(.action-keep)';

function normalize(text) {
  return String(text || '')
    .replace(/\p{Extended_Pictographic}|️/gu, '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function enhance(button) {
  if (button.querySelector('svg, img')) return;
  const label = button.textContent.trim();
  const action = TEXT_TO_ACTION[normalize(label)];
  if (!action) return;

  if (!button.title || button.dataset.actionLabel) button.title = label;
  button.dataset.actionLabel = label;
  button.setAttribute('aria-label', label);
  // Mantém as classes originais (o JS da tela pode usá-las nos cliques).
  [...button.classList]
    .filter((c) => c.startsWith('action-icon--'))
    .forEach((c) => button.classList.remove(c));
  button.classList.add('action-icon', 'action-icon--table', `action-icon--${action}`);
  button.innerHTML = actionIconSvg(action);

  // As células de ação com mais de um ícone ficam lado a lado.
  const cellGroup = button.parentElement;
  if (cellGroup && cellGroup.tagName !== 'TD') {
    cellGroup.classList.add('action-icons');
  }
}

function scan(root = document) {
  if (root.nodeType !== 1 && root !== document) return;
  if (root.matches?.(SELECTOR)) enhance(root);
  root.querySelectorAll?.(SELECTOR).forEach(enhance);
}

let pending = false;
const queue = new Set();

function flush() {
  pending = false;
  queue.forEach(scan);
  queue.clear();
}

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    const target = mutation.type === 'characterData'
      ? mutation.target.parentElement
      : mutation.target;
    if (!target) continue;
    if (mutation.type === 'childList') {
      mutation.addedNodes.forEach((node) => node.nodeType === 1 && queue.add(node));
      if (target.closest?.('td')) queue.add(target);
    } else if (target.closest?.('td')) {
      queue.add(target);
    }
  }
  if (queue.size && !pending) {
    pending = true;
    requestAnimationFrame(flush);
  }
});

function start() {
  if (document.documentElement.classList.contains('ui-classic')) return;
  scan(document);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
