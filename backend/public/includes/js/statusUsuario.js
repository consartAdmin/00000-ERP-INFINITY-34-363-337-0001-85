(function () {
  // Em vez de sair se já existir, vamos REUTILIZAR a barra
  let bar = document.getElementById('status-usuario-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'status-usuario-bar';
    document.body.appendChild(bar);
  }

  // Decodifica JWT (sem libs externas)
  function decodeJwt(token) {
    try {
      const payload = token.split('.')[1] || '';
      const base64 = payload
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(payload.length / 4) * 4, '=');
      return JSON.parse(atob(base64));
    } catch {
      return null;
    }
  }

  // Lê token de vários lugares (compatibilidade com código antigo)
  function getRawToken() {
    return (
      localStorage.getItem('token') ||
      localStorage.getItem('auth_token') ||
      sessionStorage.getItem('token') ||
      sessionStorage.getItem('auth_token')
    );
  }

  function getUsuarioAtual() {
    const token = getRawToken();
    if (!token) {
      return { nome: 'Não autenticado', id: null, email: '', perfil: '', exp: null };
    }
    const p = decodeJwt(token) || {};
    console.log('[status-usuario] payload JWT:', p);

    const id =
      p.id ?? p.user_id ?? p.sub ?? null;
    const nome =
      p.nome ??
      p.name ??
      p.username ??
      p.login ??
      (p.email ? p.email.split('@')[0] : 'Usuário');
    const email = p.email ?? '';
    const perfil = p.access_level ?? p.role ?? p.perfil ?? p.permissao ?? '';
    const exp = p.exp ? p.exp * 1000 : null; // ms

    return { id, nome, email, perfil, exp };
  }

  function formatarTempo(msRestante) {
    const totalSeg = Math.max(0, Math.floor(msRestante / 1000));
    const h = String(Math.floor(totalSeg / 3600)).padStart(2, '0');
    const m = String(Math.floor((totalSeg % 3600) / 60)).padStart(2, '0');
    const s = String(totalSeg % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  // Empresa ativa (BH3 x CONSART): o menu (menuConsart.js) mostra só os
  // módulos da empresa escolhida. Fica salva no navegador.
  // LOGISTICS, PRODNEX e CONSART são outros projetos (backend-logistics/,
  // backend-prodnex/ e backend-consart/ no repositório), cada um com seu
  // backend e .env: o botão abre o outro sistema. Este arquivo é igual nos
  // quatro; só PROJETO muda. Com URL_PROJETO.CONSART vazio, a CONSART volta a
  // ser só o filtro de menu dentro do Infinity (como antes do backend-consart).
  const PROJETO = 'INFINITY'; // 'INFINITY' | 'CONSART' | 'LOGISTICS' | 'PRODNEX'
  // Demonstração: o mesmo Infinity servido em /demo (basePath.js marca a página)
  const DEMO = PROJETO === 'INFINITY' && window.__storageScope === 'demo:';
  const URL_PROJETO = {
    CONSART: 'https://erp.consart.com.br/consart/public/home/home.html',
    INFINITY: 'https://erp.consart.com.br/public/home/home.html',
    LOGISTICS: 'https://erp.consart.com.br/logistica-demo/public/home/home.html',
    PRODNEX: 'https://erp.consart.com.br/prodnex/public/home/home.html',
  };
  const COMPANY_KEY = 'consart:active-company';
  const EMPRESAS = [
    { code: 'BH3', label: 'BH3 DISTRIBUIDORA', projeto: 'INFINITY' },
    { code: 'CONSART', label: 'CONSART', projeto: URL_PROJETO.CONSART ? 'CONSART' : 'INFINITY' },
    { code: 'LOGISTICS', label: 'LOGISTICS', projeto: 'LOGISTICS' },
    { code: 'PRODNEX', label: 'PRODNEX', projeto: 'PRODNEX' },
  ];
  const EMPRESAS_LOCAIS = EMPRESAS.filter(e => e.projeto === PROJETO);

  // Link de outro projeto com ?empresa=BH3 já abre com essa empresa
  try {
    const pedida = String(new URLSearchParams(location.search).get('empresa') || '').toUpperCase();
    if (PROJETO === 'INFINITY' && EMPRESAS_LOCAIS.some(e => e.code === pedida)) {
      localStorage.setItem(COMPANY_KEY, pedida);
    }
  } catch { }

  function getEmpresaAtiva() {
    if (PROJETO !== 'INFINITY') return PROJETO;
    try {
      const value = String(localStorage.getItem(COMPANY_KEY) || '').toUpperCase();
      return EMPRESAS_LOCAIS.some(e => e.code === value) ? value : 'BH3';
    } catch {
      return 'BH3';
    }
  }

  // Botão que leva para outro projeto. rel=noreferrer: sem Referer, o proxy
  // /logistica-demo do Infinity não devolve a página para o Logistics.
  function linkOutroProjeto({ code, label, projeto }) {
    const url = URL_PROJETO[projeto];
    if (!url) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.company = code;
      btn.textContent = label;
      btn.disabled = true;
      btn.title = `${label}: endereço ainda não configurado`;
      return btn;
    }
    const a = document.createElement('a');
    a.dataset.company = code;
    a.textContent = label;
    a.rel = 'noreferrer';
    a.href = projeto === 'INFINITY' ? `${url}?empresa=${code}` : url;
    a.title = `Abrir o sistema ${label}`;
    return a;
  }

  function montarSeletorEmpresa(el) {
    if (!el) return;
    // Demonstração (/demo): sem botões para os sistemas reais
    if (DEMO) {
      const tag = document.createElement('button');
      tag.type = 'button';
      tag.textContent = 'DEMONSTRAÇÃO';
      tag.disabled = true;
      tag.classList.add('is-active');
      tag.title = 'Versão de demonstração: os dados aqui não são reais';
      el.appendChild(tag);
      return;
    }
    // Escolha salva que virou outro projeto (ex.: CONSART com backend próprio):
    // o menu do Infinity volta para a BH3
    if (PROJETO === 'INFINITY') {
      try {
        const salva = String(localStorage.getItem(COMPANY_KEY) || '').toUpperCase();
        if (salva && !EMPRESAS_LOCAIS.some(e => e.code === salva)) {
          localStorage.setItem(COMPANY_KEY, 'BH3');
          window.dispatchEvent(new CustomEvent('consart:company-change', { detail: { company: 'BH3' } }));
        }
      } catch { }
    }
    const marcar = () => {
      const ativa = getEmpresaAtiva();
      el.querySelectorAll('[data-company]').forEach(btn => {
        const on = btn.dataset.company === ativa;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-pressed', String(on));
      });
    };

    EMPRESAS.forEach((empresa) => {
      const { code, label, projeto } = empresa;
      if (projeto !== PROJETO) {
        el.appendChild(linkOutroProjeto(empresa));
        return;
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.company = code;
      btn.textContent = label;
      btn.title = `Mostrar os módulos da ${label}`;
      btn.addEventListener('click', () => {
        if (code === getEmpresaAtiva() || PROJETO !== 'INFINITY') return;
        try { localStorage.setItem(COMPANY_KEY, code); } catch { }
        marcar();
        window.dispatchEvent(new CustomEvent('consart:company-change', { detail: { company: code } }));
      });
      el.appendChild(btn);
    });
    marcar();

    // Outra aba trocou a empresa: acompanha
    if (PROJETO !== 'INFINITY') return;
    window.addEventListener('storage', (event) => {
      if (event.key !== COMPANY_KEY) return;
      marcar();
      window.dispatchEvent(new CustomEvent('consart:company-change', { detail: { company: getEmpresaAtiva() } }));
    });
  }

  function criarOuAtualizarBarra(usuario, barEl) {
    // Substitui qualquer HTML antigo pela nossa estrutura
    barEl.innerHTML = `
      <span>👤 <strong id="su-nome"></strong> <span class="muted" id="su-id"></span></span>
      <span class="sep"></span>
      <span class="muted" id="su-perfil"></span>
      <span class="sep"></span>
      <span class="muted" id="su-host"></span>
      <div class="right">
        <div class="su-empresa" id="su-empresa" role="group" aria-label="Empresa ativa"></div>
        <span class="sep"></span>
        <span id="su-contador" class="muted"></span>
        <span id="su-hora" class="muted"></span>
        <button type="button" id="su-logout">Sair</button>
      </div>
    `;

    const host = location.hostname;
    document.getElementById('su-nome').textContent = usuario.nome || 'Usuário';
    document.getElementById('su-id').textContent = usuario.id ? `(ID ${usuario.id})` : '';
    document.getElementById('su-perfil').textContent = usuario.perfil ? `Perfil: ${usuario.perfil}` : '';
    document.getElementById('su-host').textContent = `Ambiente: ${host}`;

    montarSeletorEmpresa(document.getElementById('su-empresa'));

    // Relógio
    function tickHora() {
      const d = new Date();
      const txt = d.toLocaleTimeString('pt-BR', { hour12: false });
      const el = document.getElementById('su-hora');
      if (el) el.textContent = txt;
    }
    tickHora();
    setInterval(tickHora, 1000);

    // Contador de sessão: mostra o que terminar primeiro, a inatividade
    // (tela Configurar Timeout de Sessão) ou a validade do login (token).
    // O token é relido a cada segundo porque o sessionTimeOutConfig.js o renova.
    const elContador = document.getElementById('su-contador');
    function fimDaSessao() {
      const sto = window.__CONSART_STO__;
      if (sto && typeof sto.deadline === 'function') return sto.deadline();
      const exp = getUsuarioAtual().exp;
      return { at: exp, reason: exp ? 'token' : null };
    }
    function tickSessao() {
      if (!elContador) return;
      const { at, reason } = fimDaSessao();
      if (!at) {
        elContador.textContent = '';
        elContador.removeAttribute('title');
        return;
      }
      const restante = at - Date.now();
      if (restante <= 0 && reason === 'token') {
        elContador.textContent = 'Sessão expirada';
        clearInterval(timerSessao);
        // Limpa tokens e manda de volta pra tela de login
        localStorage.removeItem('token');
        localStorage.removeItem('auth_token');
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('auth_token');
        window.location.href = '/public/login/login.html?expired=1';
        return;
      }
      // Na inatividade quem desloga é o sessionTimeOutConfig.js
      elContador.textContent = `⏳ ${formatarTempo(restante)}`;
      elContador.title = reason === 'idle'
        ? 'Tempo até sair por inatividade (reinicia a cada clique ou tecla)'
        : 'Tempo até o login vencer (renova sozinho enquanto você usa o sistema)';
    }
    const timerSessao = setInterval(tickSessao, 1000);
    tickSessao();

    // Logout manual
    const btnLogout = document.getElementById('su-logout');
    if (btnLogout) {
      btnLogout.addEventListener('click', () => {
        localStorage.removeItem('token');
        localStorage.removeItem('auth_token');
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('auth_token');
        window.location.href = '/public/login/login.html';
      });
    }
  }

  const usuario = getUsuarioAtual();
  criarOuAtualizarBarra(usuario, bar);
})();
