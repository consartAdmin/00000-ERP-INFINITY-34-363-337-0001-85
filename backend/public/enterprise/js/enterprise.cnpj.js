// ╔══════════════════════════════════════════════════════════════════════╗
// ║ enterprise.cnpj.js                                                  ║
// ║ Preenche o cadastro da empresa a partir do CNPJ                     ║
// ║ Usa a rota já existente GET /api/public-cnpj/:cnpj (publica.cnpj.ws)║
// ╚══════════════════════════════════════════════════════════════════════╝

import { SELECTORS } from './enterprise.config.js';
import { $, applyCepMask, applyPhoneMask, onlyDigits } from './enterprise.utils.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';

const PUBLIC_CNPJ_API = '/api/public-cnpj';

let lastQueriedCnpj = '';
let requestSeq = 0;

function pickInscricaoEstadual(list = [], uf = '') {
  if (!Array.isArray(list) || !list.length) return '';
  const match = list.find((ie) => ie?.ativo && ie?.estado?.sigla === uf)
    || list.find((ie) => ie?.ativo)
    || list[0];
  return match?.inscricao_estadual || '';
}

/**
 * Converte o payload da API pública para os campos do formulário de Empresas.
 * Só devolve chaves com valor (campo vazio na API não apaga o que já existe).
 */
function mapCnpjToEnterprise(raw) {
  const d = raw?.dados || raw?.data || raw || {};
  const est = d.estabelecimento || {};
  const uf = String(est.estado?.sigla || est.uf || '').toUpperCase();

  const tipoLogradouro = est.tipo_logradouro ? String(est.tipo_logradouro).toUpperCase() : '';
  const address = [tipoLogradouro, est.logradouro].filter(Boolean).join(' ');

  let phone = '';
  if (est.telefone1) phone = applyPhoneMask(`${est.ddd1 || ''}${est.telefone1}`);

  const situacao = String(est.situacao_cadastral || '').toUpperCase();
  const simples = String(d.simples?.simples || '').toUpperCase();

  let taxRegime = '';
  if (simples === 'SIM') taxRegime = '1';
  else if (simples === 'NÃO' || simples === 'NAO') taxRegime = '3';

  const values = {
    corporate_name: d.razao_social || '',
    trade_name: est.nome_fantasia || '',
    state_registration: pickInscricaoEstadual(est.inscricoes_estaduais, uf),
    tax_regime_code: taxRegime,
    status: situacao ? (situacao === 'ATIVA' ? 'ACTIVE' : 'INACTIVE') : '',
    opening_date: est.data_inicio_atividade ? String(est.data_inicio_atividade).slice(0, 10) : '',
    cnae: est.atividade_principal?.id || est.atividade_principal?.subclasse || '',
    zip_code: est.cep ? applyCepMask(est.cep) : '',
    address,
    address_number: est.numero || '',
    address_complement: est.complemento || '',
    district: est.bairro || '',
    city: est.cidade?.nome || '',
    state: uf.slice(0, 2),
    city_ibge_code: est.cidade?.ibge_id ? String(est.cidade.ibge_id) : '',
    phone,
    email: est.email ? String(est.email).toLowerCase() : '',
  };

  return Object.fromEntries(
    Object.entries(values).filter(([, v]) => String(v ?? '').trim() !== ''),
  );
}

/**
 * Nova empresa: substitui pelos dados da consulta (o CNPJ manda).
 * Empresa existente: só completa os campos que estão vazios.
 */
function applyValues(values, { overwrite }) {
  let filled = 0;

  Object.entries(values).forEach(([name, value]) => {
    const el = $(SELECTORS[name]);
    if (!el) return;

    const current = String(el.value ?? '').trim();
    if (!overwrite && current !== '') return;

    if (el.tagName === 'SELECT' && ![...el.options].some((o) => o.value === value)) return;

    el.value = value;
    filled += 1;
  });

  return filled;
}

function setLoading(loading) {
  const input = $(SELECTORS.cnpj);
  const label = document.querySelector(`label[for="${input?.id || 'cnpj'}"]`);

  if (input) {
    input.readOnly = loading;
    input.setAttribute('aria-busy', String(loading));
  }
  if (label) label.textContent = loading ? 'CNPJ * (consultando...)' : 'CNPJ *';
}

export async function fillEnterpriseFromCnpj({ force = false } = {}) {
  const input = $(SELECTORS.cnpj);
  const cnpj = onlyDigits(input?.value);

  if (cnpj.length !== 14) return;
  if (!force && cnpj === lastQueriedCnpj) return;

  lastQueriedCnpj = cnpj;
  const seq = ++requestSeq;
  const isNew = !String($(SELECTORS.enterpriseId)?.value || '').trim();

  setLoading(true);

  try {
    const response = await fetch(`${PUBLIC_CNPJ_API}/${cnpj}`, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });

    let json = null;
    try { json = await response.json(); } catch { json = null; }

    if (seq !== requestSeq) return; // o usuário já digitou outro CNPJ

    if (!response.ok) {
      throw new Error(json?.message || `Falha na consulta de CNPJ (HTTP ${response.status}).`);
    }

    const filled = applyValues(mapCnpjToEnterprise(json), { overwrite: isNew });

    showCenterModal({
      variant: 'success',
      title: 'CNPJ encontrado',
      message: filled
        ? 'Dados da empresa e endereço preenchidos pela consulta pública. Confira antes de salvar.'
        : 'Consulta feita. Os campos já estavam preenchidos e foram mantidos.',
      timeoutMs: 2500,
    });
  } catch (error) {
    if (seq !== requestSeq) return;
    lastQueriedCnpj = ''; // permite tentar de novo no próximo blur
    showCenterModal({
      variant: 'warning',
      title: 'Consulta de CNPJ',
      message: `${error?.message || 'Não foi possível consultar o CNPJ.'} Preencha os dados manualmente.`,
    });
  } finally {
    if (seq === requestSeq) setLoading(false);
  }
}

// Chamado ao abrir o modal: o CNPJ já carregado não dispara nova consulta.
export function resetEnterpriseCnpjLookup(loadedCnpj = '') {
  lastQueriedCnpj = onlyDigits(loadedCnpj);
  requestSeq += 1;
  setLoading(false);
}

export function bindEnterpriseCnpjLookup() {
  const input = $(SELECTORS.cnpj);
  if (!input) return;

  // Ao completar os 14 dígitos (digitando ou colando) consulta automaticamente.
  input.addEventListener('input', () => {
    if (onlyDigits(input.value).length === 14) fillEnterpriseFromCnpj();
  });

  input.addEventListener('blur', () => fillEnterpriseFromCnpj());
}
