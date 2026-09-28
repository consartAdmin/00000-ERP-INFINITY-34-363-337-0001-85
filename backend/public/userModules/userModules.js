// ╔══════════════════════════════════════════════════════════════════════╗
// ║ userModules.js — Gerenciamento de Permissões User × Modules         ║
// ║ Frontend CONSART ERP                                                ║
// ╚══════════════════════════════════════════════════════════════════════╝

console.log('VERSAO_USERMODULES 1.4');

// Rotas API (ajuste aqui se o prefixo mudar no futuro)
const API_USERS         = '/api/users';          // lista de usuários
const API_MODULE_SYSTEM = '/api/module-system';  // lista de módulos do sistema
const API_USER_MODULES  = '/api/user-modules';   // permissões do usuário

// Elementos da página (IDs esperados no HTML)
const selectUsuario        = document.getElementById('selectUsuario');
const modulosContainer     = document.getElementById('modulosContainer');
const listaModulos         = document.getElementById('listaModulos');
const permissoesForm       = document.getElementById('permissoesForm');
const campoBusca           = document.getElementById('searchModulo');
const btnSalvar            = document.getElementById('btnSalvar');
const btnRecarregar        = document.getElementById('btnRecarregar');
const msgSelecione         = document.getElementById('msgSelecioneUsuario');

// Novos elementos para UX
const counterSelected       = document.getElementById('counterSelected');
const counterTotal          = document.getElementById('counterTotal');
const toggleSomenteMarcados = document.getElementById('toggleSomenteMarcados');
const btnMarcarTodos        = document.getElementById('btnMarcarTodos');
const btnLimparTodos        = document.getElementById('btnLimparTodos');

/** Estado em memória */
let modulosBaseCache = [];          // lista de módulos do sistema
let permissoesAtuais = new Map();   // modulo_id -> { id, pode_acessar }

/* ───────────────────── Helpers gerais ───────────────────── */

/** Determina qual campo do módulo casa com userModules.modulo_id */
function getModuloKey(modulo) {
  // Na sua API, o próprio "id" já é o código funcional do módulo
  const raw =
    modulo.id ??          // 👈 PRINCIPAL
    modulo.modulo_id ??   // outros formatos, se um dia aparecer
    modulo.codigo ??
    modulo.code ??
    modulo.module_code;

  if (raw == null) {
    console.warn('[userModules] Módulo sem código definido:', modulo);
    return NaN;
  }

  return Number(raw);
}

function unwrapArray(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;  // 👈 pega o data[]
  if (Array.isArray(payload.rows)) return payload.rows;
  return [];
}

/** Wrapper para usar o centerAlertModal via window.Alert */
function showToast(message, type = 'info') {
  const titles = {
    info:    'Informação',
    success: 'Sucesso',
    error:   'Erro',
    warning: 'Atenção',
    warn:    'Atenção',
  };

  if (window.Alert) {
    const t = titles[type] || titles.info;
    const fn =
      window.Alert[type] ||
      (type === 'warning' ? window.Alert.warn : window.Alert.info);

    fn(t, message);
    return;
  }

  alert(message);
}

/* ───────────────────── Contadores & filtros de UI ───────────────────── */

/** Atualiza contadores de módulos selecionados/total */
function atualizarContadores() {
  const checks = listaModulos.querySelectorAll(
    'input[type="checkbox"][data-module-id]'
  );

  const total = checks.length;
  const selecionados = Array.from(checks).filter((c) => c.checked).length;

  if (counterSelected) {
    counterSelected.textContent = `${selecionados} selecionado${
      selecionados === 1 ? '' : 's'
    }`;
  }

  if (counterTotal) {
    counterTotal.textContent = `de ${total} módulo${total === 1 ? '' : 's'}`;
  }
}

/** Aplica filtro de texto + "somente marcados" sobre os cards */
function aplicarFiltrosUI() {
  const termo = campoBusca.value.toLowerCase().trim();
  const apenasMarcados = toggleSomenteMarcados?.checked ?? false;

  const itens = listaModulos.querySelectorAll('.modulo-item');

  itens.forEach((item) => {
    const chk = item.querySelector('input[type="checkbox"][data-module-id]');
    if (!chk) return;

    const texto = item.textContent.toLowerCase();
    let visivel = true;

    if (termo && !texto.includes(termo)) {
      visivel = false;
    }

    if (apenasMarcados && !chk.checked) {
      visivel = false;
    }

    item.style.display = visivel ? '' : 'none';
  });
}

/* ───────────────────── Carregamento de dados ───────────────────── */

/** Carrega todos os usuários para o select */
async function carregarUsuarios() {
  try {
    const res = await fetch(API_USERS);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();

    const usuarios = unwrapArray(payload);

    selectUsuario.innerHTML =
      '<option value="">-- Selecione um usuário --</option>';

    usuarios.forEach((u) => {
      const opt = document.createElement('option');
      // compatível com usersApi (user_id) e outros formatos
      opt.value = u.user_id ?? u.id;
      opt.textContent = u.name || u.nome || `Usuário #${opt.value}`;
      selectUsuario.appendChild(opt);
    });
  } catch (err) {
    console.error('[ERRO USUÁRIOS]', err);
    showToast('Erro ao carregar usuários.', 'error');
    selectUsuario.innerHTML =
      '<option value="">Erro ao carregar usuários</option>';
  }
}

/** Carrega todos módulos ativos (com cache) */
async function carregarTodosModulos() {
  if (modulosBaseCache.length) return modulosBaseCache;

  try {
    const res = await fetch(API_MODULE_SYSTEM);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    const modulos = unwrapArray(payload);

    // filtra inativos se houver flag
    modulosBaseCache = modulos.filter((m) => m.is_active !== false);
    return modulosBaseCache;
  } catch (err) {
    console.error('[ERRO MÓDULOS]', err);
    showToast('Erro ao carregar módulos.', 'error');
    return [];
  }
}

/** Carrega permissões atuais de um usuário (forçando um limit alto) */
async function carregarPermissoesUsuario(userId) {
  permissoesAtuais = new Map();

  if (!userId) return [];

  try {
    const params = new URLSearchParams();
    params.set('usuario_id', String(userId));
    // 🔥 força carregar todos os vínculos desse usuário
    params.set('limit', '1000');
    params.set('offset', '0');

    // 👉 usamos /api/user-modules?usuario_id=...&limit=1000&offset=0
    const url = `${API_USER_MODULES}?${params.toString()}`;
    console.log('[userModules] Carregando permissões de:', url);

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const payload = await res.json();
    const perms = unwrapArray(payload);

    perms.forEach((p) => {
      const moduloId = Number(
        p.modulo_id ??
          p.module_id ??
          p.modulo_codigo ??
          p.codigo ??
          p.code ??
          p.module_code ??
          p.id_modulo
      );

      if (!Number.isFinite(moduloId)) return;
      permissoesAtuais.set(moduloId, {
        id: p.id,
        pode_acessar: !!(p.pode_acessar ?? p.canAccess ?? p.can_access),
      });
    });

    console.log(
      '[userModules] Permissões recebidas:',
      perms.length,
      'registros'
    );

    return perms;
  } catch (err) {
    console.error('[ERRO PERMISSÕES USUÁRIO]', err);
    showToast('Erro ao carregar permissões do usuário.', 'error');
    return [];
  }
}

/** Monta grid de módulos para o usuário selecionado */
async function carregarModulosParaUsuario(userId) {
  if (!userId) {
    modulosContainer.classList.add('hidden');
    listaModulos.innerHTML = '';
    msgSelecione.classList.remove('hidden');
    atualizarContadores();
    return;
  }

  btnSalvar.disabled = true;
  listaModulos.innerHTML = '<p>Carregando módulos...</p>';
  msgSelecione.classList.add('hidden');

  try {
    const [modulosBase] = await Promise.all([
      carregarTodosModulos(),
      carregarPermissoesUsuario(userId), // atualiza permissoesAtuais
    ]);

    listaModulos.innerHTML = '';

    modulosBase.forEach((modulo) => {
      const moduloId = getModuloKey(modulo); // 🔑 usa o mesmo "código" da userModules
      if (!Number.isFinite(moduloId)) return;

      const perm = permissoesAtuais.get(moduloId);
      const canAccess = perm ? !!perm.pode_acessar : false;

      // Card do módulo
      const item = document.createElement('div');
      item.className = 'modulo-item';
      if (canAccess) item.classList.add('modulo-item--checked');
      item.dataset.moduleId = String(moduloId);

      const label = document.createElement('label');
      label.className = 'modulo-label';
      label.htmlFor = `modulo_${moduloId}`;

      // Topo: tag + toggle
      const topRow = document.createElement('div');
      topRow.className = 'modulo-top-row';

      const tag = document.createElement('span');
      tag.className = 'modulo-tag';
      tag.textContent = 'Módulo';

      const toggleWrap = document.createElement('span');
      toggleWrap.className = 'modulo-checkbox';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `modulo_${moduloId}`;
      checkbox.dataset.moduleId = String(moduloId);
      checkbox.checked = canAccess;

      const toggleLabel = document.createElement('span');
      toggleLabel.textContent = canAccess ? 'Permitido' : 'Bloqueado';

      toggleWrap.appendChild(checkbox);
      toggleWrap.appendChild(toggleLabel);

      topRow.appendChild(tag);
      topRow.appendChild(toggleWrap);

      // Corpo: nome + descrição
      const nomeSpan = document.createElement('span');
      nomeSpan.className = 'modulo-nome';
      nomeSpan.textContent =
        modulo.name || modulo.nome || `Módulo #${moduloId}`;

      const descSpan = document.createElement('span');
      descSpan.className = 'modulo-descricao';
      if (modulo.description || modulo.descricao) {
        descSpan.textContent = modulo.description || modulo.descricao;
      }

      // Ajunta tudo
      label.appendChild(topRow);
      label.appendChild(nomeSpan);
      if (descSpan.textContent) label.appendChild(descSpan);

      item.appendChild(label);
      listaModulos.appendChild(item);

      // Listener de mudança para estilizar card e atualizar contadores
      checkbox.addEventListener('change', () => {
        item.classList.toggle('modulo-item--checked', checkbox.checked);
        toggleLabel.textContent = checkbox.checked ? 'Permitido' : 'Bloqueado';
        atualizarContadores();
        aplicarFiltrosUI();
      });
    });

    modulosContainer.classList.remove('hidden');
    atualizarContadores();
    aplicarFiltrosUI();
  } catch (err) {
    console.error('[ERRO MÓDULOS]', err);
    showToast('Erro ao carregar módulos.', 'error');
  } finally {
    btnSalvar.disabled = false;
  }
}

/* ───────────────────── Filtros / busca ───────────────────── */

// Filtro de texto
campoBusca.addEventListener('input', () => {
  aplicarFiltrosUI();
});

// Filtro "somente marcados"
if (toggleSomenteMarcados) {
  toggleSomenteMarcados.addEventListener('change', () => {
    aplicarFiltrosUI();
  });
}

/* ───────────────────── Ações em massa (marcar / limpar) ───────────────── */

function alterarMarcacaoVisiveis(marcar) {
  const itens = listaModulos.querySelectorAll('.modulo-item');

  itens.forEach((item) => {
    if (item.style.display === 'none') return; // respeita filtros ativos
    const chk = item.querySelector('input[type="checkbox"][data-module-id]');
    const labelStatus = item.querySelector('.modulo-checkbox span:nth-child(2)');
    if (!chk) return;

    chk.checked = marcar;
    item.classList.toggle('modulo-item--checked', marcar);
    if (labelStatus) {
      labelStatus.textContent = marcar ? 'Permitido' : 'Bloqueado';
    }
  });

  atualizarContadores();
  aplicarFiltrosUI();
}

if (btnMarcarTodos) {
  btnMarcarTodos.addEventListener('click', () => {
    alterarMarcacaoVisiveis(true);
  });
}

if (btnLimparTodos) {
  btnLimparTodos.addEventListener('click', () => {
    alterarMarcacaoVisiveis(false);
  });
}

/* ───────────────────── Salvar permissões ───────────────────── */

/**
 * Salva permissões do usuário:
 * - Para cada módulo:
 *   - se marcado & já existe: PUT /api/user-modules/:id { pode_acessar: true }
 *   - se marcado & não existe: POST /api/user-modules { usuario_id, modulo_id, pode_acessar: true }
 *   - se desmarcado & já existe: PUT /api/user-modules/:id { pode_acessar: false }
 *   - se desmarcado & não existe: ignora
 */
permissoesForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const usuarioId = selectUsuario.value;
  if (!usuarioId) {
    showToast('Selecione um usuário antes de salvar.', 'error');
    return;
  }

  const checks = Array.from(
    listaModulos.querySelectorAll('input[type="checkbox"][data-module-id]')
  );

  if (!checks.length) {
    showToast('Nenhum módulo encontrado para salvar.', 'error');
    return;
  }

  btnSalvar.disabled = true;
  const originalLabel = btnSalvar.textContent;
  btnSalvar.textContent = 'Salvando...';

  try {
    const tarefas = checks.map(async (chk) => {
      const moduloId = Number(chk.dataset.moduleId);
      const querAcesso = chk.checked;

      const permAtual = permissoesAtuais.get(moduloId);

      // Já existe registro para este módulo → usar PUT
      if (permAtual && permAtual.id) {
        // Se o estado não mudou, não faz nada
        if (!!permAtual.pode_acessar === querAcesso) return;

        const res = await fetch(`${API_USER_MODULES}/${permAtual.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pode_acessar: querAcesso }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          const msg = data.error || `HTTP ${res.status}`;
          throw new Error(`Erro ao atualizar módulo ${moduloId}: ${msg}`);
        }
        return;
      }

      // Não existe registro e está desmarcado → nada a fazer
      if (!querAcesso) return;

      // Não existe registro e está marcado → cria (POST)
      const res = await fetch(API_USER_MODULES, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usuario_id: Number(usuarioId),
          modulo_id: moduloId,
          pode_acessar: true,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        const msg = data.error || `HTTP ${res.status}`;

        // 👇 Se for erro de duplicidade (já existe vínculo), tratamos como "OK"
        if (
          typeof msg === 'string' &&
          msg.toLowerCase().includes('já existe um vínculo')
        ) {
          console.warn(
            `[userModules] Permissão já existe para usuario=${usuarioId}, modulo=${moduloId}. Ignorando erro de duplicidade.`
          );

          // Atualiza o mapa em memória para refletir que existe registro
          await carregarPermissoesUsuario(usuarioId);
          return;
        }

        // Outros erros ainda sobem
        throw new Error(
          `Erro ao criar permissão para módulo ${moduloId}: ${msg}`
        );
      }
    });

    await Promise.all(tarefas);

    showToast('Permissões salvas com sucesso!', 'success');

    // Recarrega mapa de permissões atualizado (garante estado correto)
    await carregarPermissoesUsuario(usuarioId);
  } catch (err) {
    console.error('[ERRO SALVAR PERMISSÕES]', err);
    showToast('Erro ao salvar permissões. Verifique o console.', 'error');
  } finally {
    btnSalvar.disabled = false;
    btnSalvar.textContent = originalLabel;
  }
});

/* ───────────────────── Eventos / init ───────────────────── */

// Ao trocar usuário, recarrega módulos
selectUsuario.addEventListener('change', () => {
  const userId = selectUsuario.value;
  carregarModulosParaUsuario(userId);
});

// Botão recarregar
btnRecarregar.addEventListener('click', () => {
  const userId = selectUsuario.value;
  if (userId) {
    carregarModulosParaUsuario(userId);
  } else {
    carregarUsuarios(); // só recarrega lista de usuários
  }
});

// Inicialização
carregarUsuarios();
