// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: fiscalClassification.profiles.js                             ║
// ║ MODULE: Fiscal Classification — Fiscal Profiles                    ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { listFiscalProfiles } from './fiscalClassification.api.js';
import { ROUTES } from './fiscalClassification.config.js';
import { state } from './fiscalClassification.state.js';
import { $, logError, normalizeRows } from './fiscalClassification.utils.js';

/** Preenche o select do modal (#fiscal_profile_id) e o filtro (#filtroPerfil). */
export async function loadFiscalProfiles() {
  const profileSelect = $('#fiscal_profile_id');
  const filterSelect = $('#filtroPerfil');
  state.fiscalProfilesById.clear();

  if (profileSelect) {
    profileSelect.innerHTML = '';
    profileSelect.add(new Option('— Sem perfil vinculado —', ''));
  }
  if (filterSelect) {
    filterSelect.innerHTML = '';
    filterSelect.add(new Option('Todos', ''));
  }

  try {
    const params = new URLSearchParams({ limit: '500', offset: '0' });
    const payload = await listFiscalProfiles(`${ROUTES.fiscalProfiles}?${params.toString()}`);

    normalizeRows(payload).forEach((profile) => {
      const id = profile.fiscal_profile_id;
      if (id == null) return;

      const name = profile.profile_name || `Perfil #${id}`;
      state.fiscalProfilesById.set(String(id), name);
      profileSelect?.add(new Option(name, String(id)));
      filterSelect?.add(new Option(name, String(id)));
    });
  } catch (error) {
    logError('Erro ao carregar perfis fiscais', error);
  }
}

export function getFiscalProfileName(profileId) {
  if (profileId == null || profileId === '') return '';
  return state.fiscalProfilesById.get(String(profileId)) || '';
}
