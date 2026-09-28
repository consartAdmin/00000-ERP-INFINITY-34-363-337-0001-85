import { API, elements } from './userModules.config.js';
import { showToast } from './userModules.modal.js';
import { resetPermissoes, setModulosBaseCache, state } from './userModules.state.js';
import { unwrapArray } from './userModules.utils.js';

export async function carregarUsuarios() {
  try {
    const res = await fetch(API.users);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const usuarios = unwrapArray(await res.json());

    elements.selectUsuario.innerHTML =
      '<option value="">-- Selecione um usuário --</option>';

    usuarios.forEach((usuario) => {
      const option = document.createElement('option');
      option.value = usuario.user_id ?? usuario.id;
      option.textContent =
        usuario.name || usuario.nome || `Usuário #${option.value}`;
      elements.selectUsuario.appendChild(option);
    });
  } catch (error) {
    console.error('[ERRO USUÁRIOS]', error);
    showToast('Erro ao carregar usuários.', 'error');
    elements.selectUsuario.innerHTML =
      '<option value="">Erro ao carregar usuários</option>';
  }
}

export async function carregarTodosModulos() {
  if (state.modulosBaseCache.length) return state.modulosBaseCache;

  try {
    const res = await fetch(API.modules);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const modulos = unwrapArray(await res.json()).filter(
      (modulo) => modulo.is_active !== false
    );
    setModulosBaseCache(modulos);
    return modulos;
  } catch (error) {
    console.error('[ERRO MÓDULOS]', error);
    showToast('Erro ao carregar módulos.', 'error');
    return [];
  }
}

export async function carregarPermissoesUsuario(userId) {
  resetPermissoes();
  if (!userId) return [];

  try {
    const params = new URLSearchParams({
      usuario_id: String(userId),
      limit: '1000',
      offset: '0',
    });
    const url = `${API.userModules}?${params.toString()}`;
    console.log('[userModules] Carregando permissões de:', url);

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const permissoes = unwrapArray(await res.json());

    permissoes.forEach((permissao) => {
      const moduloId = Number(
        permissao.modulo_id ??
          permissao.module_id ??
          permissao.modulo_codigo ??
          permissao.codigo ??
          permissao.code ??
          permissao.module_code ??
          permissao.id_modulo
      );
      if (!Number.isFinite(moduloId)) return;
      state.permissoesAtuais.set(moduloId, {
        id: permissao.id,
        pode_acessar: !!(
          permissao.pode_acessar ?? permissao.canAccess ?? permissao.can_access
        ),
      });
    });

    console.log('[userModules] Permissões recebidas:', permissoes.length, 'registros');
    return permissoes;
  } catch (error) {
    console.error('[ERRO PERMISSÕES USUÁRIO]', error);
    showToast('Erro ao carregar permissões do usuário.', 'error');
    return [];
  }
}
