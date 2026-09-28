// ╔══════════════════════════════════════════════════════════════════════╗
// ║ crmConsartModalsSearch.js — Modais de Busca CRM (CONSART ERP)       ║
// ╚══════════════════════════════════════════════════════════════════════╝

function normalizeApiBase(apiBase = '') {
  return (apiBase || '').replace(/\/$/, '');
}

function joinUrl(base = '', endpoint = '') {
  base = base || '';
  endpoint = endpoint || '';

  if (!base) return endpoint;
  if (!endpoint) return base;

  if (base.endsWith('/') && endpoint.startsWith('/')) return base + endpoint.slice(1);
  if (!base.endsWith('/') && !endpoint.startsWith('/')) return `${base}/${endpoint}`;

  return base + endpoint;
}

function createBaseModal({ title = 'Buscar', subtitle = '' } = {}) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.40);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 99998;
  `;

  const dialog = document.createElement('div');
  dialog.style.cssText = `
    width: min(960px, 92vw);
    max-height: 86vh;
    background: #ffffff;
    border-radius: 18px;
    box-shadow: 0 24px 60px rgba(15, 23, 42, 0.35);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  `;

  const header = document.createElement('header');
  header.style.cssText = `
    padding: 14px 18px 10px;
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  `;

  const titleWrap = document.createElement('div');

  const h2 = document.createElement('h2');
  h2.textContent = title;
  h2.style.cssText = `
    margin: 0;
    font-size: 1.15rem;
    color: #0f172a;
  `;

  const p = document.createElement('p');
  p.textContent = subtitle;
  p.style.cssText = `
    margin: 2px 0 0 0;
    font-size: 0.8rem;
    color: #64748b;
  `;

  titleWrap.appendChild(h2);
  if (subtitle) titleWrap.appendChild(p);

  const btnClose = document.createElement('button');
  btnClose.type = 'button';
  btnClose.textContent = '×';
  btnClose.title = 'Fechar';
  btnClose.style.cssText = `
    border: none;
    background: transparent;
    font-size: 1.3rem;
    line-height: 1;
    cursor: pointer;
    color: #64748b;
    padding: 4px 6px;
    border-radius: 999px;
  `;

  header.appendChild(titleWrap);
  header.appendChild(btnClose);

  const content = document.createElement('div');
  content.style.cssText = `
    padding: 10px 16px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 220px;
  `;

  const footer = document.createElement('footer');
  footer.style.cssText = `
    padding: 10px 16px 12px;
    border-top: 1px solid #e5e7eb;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  `;

  const btnCancel = document.createElement('button');
  btnCancel.type = 'button';
  btnCancel.textContent = 'Cancelar';
  btnCancel.style.cssText = `
    padding: 6px 14px;
    border-radius: 999px;
    border: none;
    background: #e5e7eb;
    color: #374151;
    font-size: 0.86rem;
    font-weight: 500;
    cursor: pointer;
  `;

  footer.appendChild(btnCancel);

  dialog.appendChild(header);
  dialog.appendChild(content);
  dialog.appendChild(footer);
  overlay.appendChild(dialog);

  return { overlay, dialog, content, btnClose, btnCancel };
}

function closeModal(overlay) {
  if (!overlay || !overlay.parentNode) return;

  overlay.style.opacity = '0';
  overlay.style.transition = 'opacity 120ms ease-out';

  setTimeout(() => {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }, 130);
}

/* =======================================================================
   BUSCA DE CLIENTES
   ======================================================================= */

export function openCrmCustomerSearchModal({
  apiBase = '',
  onPick,
  endpoint = '/api/customers/search',
} = {}) {
  apiBase = normalizeApiBase(
    apiBase || (typeof window !== 'undefined' ? window.apiBase : '') || ''
  );

  const { overlay, content, btnClose, btnCancel } = createBaseModal({
    title: 'Localizar cliente',
    subtitle: 'Digite parte do nome, código ou documento do cliente.',
  });

  const searchRow = document.createElement('div');
  searchRow.style.cssText = `
    display: flex;
    gap: 8px;
    align-items: center;
  `;

  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'Buscar cliente...';
  input.style.cssText = `
    flex: 1;
    padding: 7px 10px;
    border-radius: 999px;
    border: 1px solid #d1d5db;
    font-size: 0.9rem;
  `;

  const btnSearch = document.createElement('button');
  btnSearch.type = 'button';
  btnSearch.textContent = 'Buscar';
  btnSearch.style.cssText = `
    padding: 7px 14px;
    border-radius: 999px;
    border: none;
    background: #2563eb;
    color: #ffffff;
    font-size: 0.86rem;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
  `;

  searchRow.appendChild(input);
  searchRow.appendChild(btnSearch);

  const results = document.createElement('div');
  results.style.cssText = `
    margin-top: 8px;
    border-radius: 12px;
    border: 1px solid #e5e7eb;
    max-height: 340px;
    overflow: auto;
    padding: 4px;
    background: #f9fafb;
  `;

  results.innerHTML = `
    <div style="padding:10px;font-size:0.8rem;color:#6b7280;">
      Digite algo e clique em "Buscar" para localizar clientes.
    </div>
  `;

  content.appendChild(searchRow);
  content.appendChild(results);

  let selectedIndex = -1;

  function getCustomerCards() {
    return Array.from(results.querySelectorAll('button[data-crm-customer-card="1"]'));
  }

  function updateCustomerSelection() {
    const cards = getCustomerCards();

    cards.forEach((card, index) => {
      const selected = index === selectedIndex;

      card.style.background = selected ? '#dbeafe' : '#ffffff';
      card.style.outline = selected ? '2px solid #2563eb' : 'none';
      card.style.boxShadow = selected
        ? '0 4px 12px rgba(37, 99, 235, 0.22)'
        : '0 1px 4px rgba(15, 23, 42, 0.06)';
    });

    if (cards[selectedIndex]) {
      cards[selectedIndex].scrollIntoView({ block: 'nearest' });
    }
  }

  async function doSearch() {
    const q = (input.value || '').trim();

    if (!q) {
      input.focus();
      return;
    }

    selectedIndex = -1;

    results.innerHTML = `
      <div style="padding:10px;font-size:0.8rem;color:#6b7280;">
        Buscando clientes...
      </div>
    `;

    try {
      const href = joinUrl(apiBase || '', endpoint);
      const urlStr = `${href}${href.includes('?') ? '&' : '?'}q=${encodeURIComponent(q)}`;

      const res = await fetch(urlStr);
      const json = await res.json();

      const list = json.data || json.rows || [];
      results.innerHTML = '';

      if (!list.length) {
        results.innerHTML = `
          <div style="padding:10px;font-size:0.8rem;color:#6b7280;">
            Nenhum cliente encontrado com esse critério.
          </div>
        `;
        return;
      }

      list.forEach((customer) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.dataset.crmCustomerCard = '1';

        card.style.cssText = `
          width: 100%;
          text-align: left;
          border: none;
          background: #ffffff;
          border-radius: 10px;
          padding: 8px 10px;
          margin-bottom: 6px;
          cursor: pointer;
          box-shadow: 0 1px 4px rgba(15, 23, 42, 0.06);
          display: flex;
          flex-direction: column;
          gap: 2px;
          font-size: 0.82rem;
        `;

        const name =
          customer.trade_name ||
          customer.legal_name ||
          customer.nome_fantasia ||
          customer.razao_social ||
          customer.name ||
          customer.customer_name ||
          `Cliente #${customer.customer_id || customer.id}`;

        const doc =
          customer.tax_id ||
          customer.cnpj_cpf ||
          customer.document ||
          '';

        const phone =
          customer.phone ||
          customer.phone_number ||
          customer.mobile_number ||
          customer.telefone ||
          '';

        const line1 = document.createElement('div');
        line1.textContent = name;
        line1.style.cssText = `
          font-weight: 600;
          color: #0f172a;
        `;

        const infos = [];
        if (doc) infos.push(`Doc: ${doc}`);
        if (customer.email) infos.push(`Email: ${customer.email}`);
        if (phone) infos.push(`Tel: ${phone}`);

        const line2 = document.createElement('div');
        line2.textContent = infos.join(' • ') || 'Sem dados adicionais';
        line2.style.cssText = `
          color: #6b7280;
        `;

        card.appendChild(line1);
        card.appendChild(line2);

        card.addEventListener('click', () => {
          if (typeof onPick === 'function') {
            onPick({
              ...customer,
              id: customer.customer_id ?? customer.id ?? null,
              customer_id: customer.customer_id ?? customer.id ?? null,
              name,
              document: doc,
              tax_id: customer.tax_id ?? customer.cnpj_cpf ?? doc ?? null,
              cnpj_cpf: customer.cnpj_cpf ?? customer.tax_id ?? doc ?? null,
              email: customer.email ?? customer.email_address ?? null,
              phone:
                customer.phone ??
                customer.phone_number ??
                customer.mobile_number ??
                customer.telefone ??
                null,
            });
          }

          closeModal(overlay);
        });

        results.appendChild(card);
      });

      selectedIndex = 0;
      updateCustomerSelection();
    } catch (err) {
      console.error('[CRM Modal Search] Erro ao buscar clientes:', err);

      results.innerHTML = `
        <div style="padding:10px;font-size:0.8rem;color:#b91c1c;">
          Erro ao buscar clientes. Tente novamente.
        </div>
      `;
    }
  }

  btnSearch.addEventListener('click', doSearch);

  input.addEventListener('keydown', (e) => {
    const cards = getCustomerCards();

    if (e.key === 'ArrowDown') {
      e.preventDefault();

      if (!cards.length) return;

      selectedIndex = selectedIndex < cards.length - 1 ? selectedIndex + 1 : 0;
      updateCustomerSelection();
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();

      if (!cards.length) return;

      selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : cards.length - 1;
      updateCustomerSelection();
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();

      if (cards.length && selectedIndex >= 0) {
        cards[selectedIndex].click();
        return;
      }

      doSearch();
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal(overlay);
    }
  });

  btnClose.addEventListener('click', () => closeModal(overlay));
  btnCancel.addEventListener('click', () => closeModal(overlay));

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal(overlay);
  });

  document.body.appendChild(overlay);
  input.focus();
}

/* =======================================================================
   BUSCA DE VENDEDORES
   ======================================================================= */

export function openCrmSellerSearchModal({
  apiBase = '',
  onPick,
  endpoint = '/api/sellers',
} = {}) {
  apiBase = normalizeApiBase(
    apiBase || (typeof window !== 'undefined' ? window.apiBase : '') || ''
  );

  const { overlay, content, btnClose, btnCancel } = createBaseModal({
    title: 'Localizar vendedor',
    subtitle: 'Digite parte do nome, apelido ou documento do vendedor.',
  });

  const searchRow = document.createElement('div');
  searchRow.style.cssText = `
    display: flex;
    gap: 8px;
    align-items: center;
  `;

  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'Buscar vendedor...';
  input.style.cssText = `
    flex: 1;
    padding: 7px 10px;
    border-radius: 999px;
    border: 1px solid #d1d5db;
    font-size: 0.9rem;
  `;

  const btnSearch = document.createElement('button');
  btnSearch.type = 'button';
  btnSearch.textContent = 'Buscar';
  btnSearch.style.cssText = `
    padding: 7px 14px;
    border-radius: 999px;
    border: none;
    background: #2563eb;
    color: #ffffff;
    font-size: 0.86rem;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
  `;

  searchRow.appendChild(input);
  searchRow.appendChild(btnSearch);

  const results = document.createElement('div');
  results.style.cssText = `
    margin-top: 8px;
    border-radius: 12px;
    border: 1px solid #e5e7eb;
    max-height: 340px;
    overflow: auto;
    padding: 4px;
    background: #f9fafb;
  `;

  results.innerHTML = `
    <div style="padding:10px;font-size:0.8rem;color:#6b7280;">
      Digite algo e clique em "Buscar" para localizar vendedores.
    </div>
  `;

  content.appendChild(searchRow);
  content.appendChild(results);

  async function doSearch() {
    const q = (input.value || '').trim();

    if (!q) {
      input.focus();
      return;
    }

    results.innerHTML = `
      <div style="padding:10px;font-size:0.8rem;color:#6b7280;">
        Buscando vendedores...
      </div>
    `;

    try {
      const href = joinUrl(apiBase || '', endpoint);
      const urlStr = `${href}${href.includes('?') ? '&' : '?'}q=${encodeURIComponent(q)}`;

      const res = await fetch(urlStr);
      const json = await res.json();

      const list = json.data || json.rows || [];
      results.innerHTML = '';

      if (!list.length) {
        results.innerHTML = `
          <div style="padding:10px;font-size:0.8rem;color:#6b7280;">
            Nenhum vendedor encontrado com esse critério.
          </div>
        `;
        return;
      }

      list.forEach((seller) => {
        const card = document.createElement('button');
        card.type = 'button';

        card.style.cssText = `
          width: 100%;
          text-align: left;
          border: none;
          background: #ffffff;
          border-radius: 10px;
          padding: 8px 10px;
          margin-bottom: 6px;
          cursor: pointer;
          box-shadow: 0 1px 4px rgba(15, 23, 42, 0.06);
          display: flex;
          flex-direction: column;
          gap: 2px;
          font-size: 0.82rem;
        `;

        const name = seller.name || seller.nome || `Vendedor #${seller.id}`;
        const nickname = seller.nickname || seller.apelido || '';
        const doc = seller.document || seller.cpf_cnpj || '';
        const phone = seller.mobile || seller.phone || seller.telefone || '';

        const line1 = document.createElement('div');
        line1.textContent = nickname ? `${name} (${nickname})` : name;
        line1.style.cssText = `
          font-weight: 600;
          color: #0f172a;
        `;

        const extra = [];
        if (doc) extra.push(`Doc: ${doc}`);
        if (phone) extra.push(`Tel: ${phone}`);
        if (seller.email) extra.push(`Email: ${seller.email}`);

        const line2 = document.createElement('div');
        line2.textContent = extra.join(' • ') || 'Sem dados adicionais';
        line2.style.cssText = `
          color: #6b7280;
        `;

        card.appendChild(line1);
        card.appendChild(line2);

        card.addEventListener('click', () => {
          if (typeof onPick === 'function') onPick(seller);
          closeModal(overlay);
        });

        results.appendChild(card);
      });
    } catch (err) {
      console.error('[CRM Modal Search] Erro ao buscar vendedores:', err);

      results.innerHTML = `
        <div style="padding:10px;font-size:0.8rem;color:#b91c1c;">
          Erro ao buscar vendedores. Tente novamente.
        </div>
      `;
    }
  }

  btnSearch.addEventListener('click', doSearch);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doSearch();
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal(overlay);
    }
  });

  btnClose.addEventListener('click', () => closeModal(overlay));
  btnCancel.addEventListener('click', () => closeModal(overlay));

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal(overlay);
  });

  document.body.appendChild(overlay);
  input.focus();
}

const crmConsartModalsSearch = {
  openCrmCustomerSearchModal,
  openCrmSellerSearchModal,
};

export default crmConsartModalsSearch;