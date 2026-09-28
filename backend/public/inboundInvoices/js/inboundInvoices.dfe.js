/* ╔══════════════════════════════════════════════════════════════════╗
   ║ inboundInvoices.dfe.js — Importar XML direto do módulo DF-e      ║
   ║ CONSART ERP | Frontend (ESM)                                     ║
   ║                                                                  ║
   ║ Lista as NF-e da caixa de entrada DF-e, baixa o XML da nota      ║
   ║ escolhida e entrega ao mesmo pipeline do botão "Importar XML".   ║
   ║ Ou seja: abre a prévia para conferência/vínculo de produtos,     ║
   ║ nunca lança estoque automaticamente.                             ║
   ╚══════════════════════════════════════════════════════════════════╝ */

'use strict';

const PAGE_SIZE = 50;

function htmlEscape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDateBR(value) {
  if (!value) return '—';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('pt-BR').format(date);
}

function formatMoneyBR(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';

  return number.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function shortenKey(key) {
  const clean = String(key || '').trim();
  if (clean.length !== 44) return clean || '—';

  return `${clean.slice(0, 10)}…${clean.slice(-6)}`;
}

export function initImportFromDfe({ core, ROUTES, state, refs }) {
  const {
    btnImportFromDfe: button,
    dfeModal: modal,
    dfeModalClose: closeButton,
    dfeModalBackdrop: backdrop,
    dfeSearch: search,
    dfeOnlyPending: onlyPending,
    dfeReload: reload,
    dfeTbody: tbody,
    dfeStatus: status,
  } = refs;

  if (!button || !modal || !tbody) {
    console.warn('[INBOUND][DFE] Elementos do modal ausentes; recurso desativado.');
    return;
  }

  let loading = false;
  let rows = [];

  function setStatus(message, tone = 'info') {
    if (!status) return;

    status.textContent = message || '';
    status.dataset.tone = tone;
  }

  // modals.css controla a visibilidade por .is-open, não pelo atributo hidden.
  function openModal() {
    modal.classList.add('is-open');
    document.body.classList.add('inbound-modal-open');
    search?.focus();
    void loadRows();
  }

  function closeModal() {
    modal.classList.remove('is-open');

    // O formulário de edição usa a mesma trava de scroll; só libera
    // quando ele também estiver fechado.
    const editorOpen = document.querySelector('#tab-form')?.hidden === false;
    if (!editorOpen) document.body.classList.remove('inbound-modal-open');
  }

  function renderRows() {
    if (!rows.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="dfe-empty">
            Nenhuma NF-e encontrada na caixa de entrada DF-e.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = rows
      .map((row) => {
        const done = row.entrada_criada === true;
        const key = String(row.chave_nfe || '').trim();

        return `
          <tr data-id="${htmlEscape(row.id)}" data-key="${htmlEscape(key)}">
            <td>${htmlEscape(formatDateBR(row.data_autorizacao || row.data_emissao))}</td>
            <td title="${htmlEscape(key)}">${htmlEscape(shortenKey(key))}</td>
            <td>${htmlEscape(row.numero || '—')}</td>
            <td>${htmlEscape(row.emitente_razao || row.emitente_cnpj || '—')}</td>
            <td class="dfe-col-right">${htmlEscape(formatMoneyBR(row.valor_total))}</td>
            <td>
              ${done
            ? '<span class="dfe-badge dfe-badge--done">Já lançada</span>'
            : `<button type="button" class="btn btn-toolbar btn-sm" data-dfe-import>
                     Importar
                   </button>`
          }
            </td>
          </tr>
        `;
      })
      .join('');
  }

  async function loadRows() {
    if (loading) return;

    loading = true;
    setStatus('Carregando notas do DF-e...');
    tbody.innerHTML = '<tr><td colspan="6" class="dfe-empty">Carregando…</td></tr>';

    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: '0',
        sort: 'data_autorizacao',
        order: 'desc',
      });

      const term = String(search?.value || '').trim();
      if (term) params.set('q', term);

      const response = await fetch(`${ROUTES.nfeInboxList()}?${params}`);
      const json = await response.json().catch(() => ({}));

      if (!response.ok || json?.success === false) {
        throw new Error(json?.message || `Erro HTTP ${response.status}.`);
      }

      const allRows = Array.isArray(json?.data) ? json.data : [];

      rows = onlyPending?.checked
        ? allRows.filter((row) => row.entrada_criada !== true)
        : allRows;

      renderRows();

      setStatus(
        `${rows.length} nota(s) listada(s)${onlyPending?.checked ? ' — pendentes de entrada' : ''}.`
      );
    } catch (error) {
      console.error('[INBOUND][DFE][LOAD]', error);

      rows = [];
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="dfe-empty">
            Não foi possível carregar a caixa de entrada DF-e.
          </td>
        </tr>
      `;

      setStatus(error?.message || 'Falha ao consultar o DF-e.', 'error');
    } finally {
      loading = false;
    }
  }

  /**
   * Baixa o XML da nota e entrega ao pipeline de importação.
   *
   * O endpoint do DF-e devolve o XML salvo em xml_completo e, quando
   * ele ainda não existe, tenta buscá-lo na SEFAZ/TecnoSpeed. Se a nota
   * exigir manifestação prévia, a resposta vem em JSON com o motivo.
   */
  async function importFromRow(rowEl) {
    const id = rowEl?.dataset.id;
    const key = rowEl?.dataset.key || '';

    if (!id) return;

    const trigger = rowEl.querySelector('[data-dfe-import]');

    if (trigger) {
      trigger.disabled = true;
      trigger.textContent = 'Baixando…';
    }

    try {
      setStatus('Baixando XML da NF-e...');

      const response = await fetch(ROUTES.nfeInboxXmlById(id));
      const text = await response.text();

      if (!response.ok) {
        let message = `Erro HTTP ${response.status}.`;

        try {
          message = JSON.parse(text)?.message || message;
        } catch {
          // resposta não-JSON: mantém a mensagem padrão
        }

        throw new Error(message);
      }

      if (!text || text.trim().length < 50) {
        throw new Error('O XML retornado está vazio.');
      }

      const file = new File(
        [text],
        `${key || id}.xml`,
        { type: 'application/xml' }
      );

      closeModal();

      await state.actions.importXmlFile?.(file);
    } catch (error) {
      console.error('[INBOUND][DFE][IMPORT]', error);

      setStatus(error?.message || 'Falha ao baixar o XML.', 'error');

      core?.toast?.error?.(
        'XML indisponível',
        error?.message || 'Não foi possível obter o XML desta NF-e.'
      );
    } finally {
      if (trigger) {
        trigger.disabled = false;
        trigger.textContent = 'Importar';
      }
    }
  }

  button.addEventListener('click', openModal);
  closeButton?.addEventListener('click', closeModal);
  backdrop?.addEventListener('click', closeModal);
  reload?.addEventListener('click', () => void loadRows());
  onlyPending?.addEventListener('change', () => void loadRows());

  search?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void loadRows();
    }
  });

  tbody.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-dfe-import]');
    if (!trigger) return;

    void importFromRow(trigger.closest('tr'));
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.classList.contains('is-open')) {
      closeModal();
    }
  });

  state.actions.openDfeImportModal = openModal;
}
