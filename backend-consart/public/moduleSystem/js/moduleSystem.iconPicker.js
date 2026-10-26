import { Modal } from '/public/includes/js/modal.js';
import { elements } from './moduleSystem.config.js';

const MODAL_ID = 'ms-modal-icons';

// Cada ícone: [emoji, palavras para a busca]
const CATEGORIAS = [
  { nome: 'Geral', icones: [
    ['🏠', 'casa inicio home'], ['🏢', 'empresa predio escritorio'], ['🏬', 'loja shopping'], ['🏭', 'fabrica industria'],
    ['🏪', 'loja comercio'], ['🏛️', 'governo orgao publico'], ['🌐', 'web internet erp sistema'], ['🖥️', 'computador sistema'],
    ['💻', 'notebook software'], ['📱', 'celular app mobile'], ['⚙️', 'configuracoes engrenagem'], ['🛠️', 'ferramentas manutencao'],
    ['🔧', 'chave ajuste'], ['🔩', 'parafuso peca'], ['🧩', 'modulo peca integracao'], ['🔗', 'link vinculo'],
    ['🔍', 'busca pesquisa lupa'], ['🔎', 'consulta lupa'], ['⭐', 'estrela favorito'], ['🚀', 'foguete lancamento'],
    ['💡', 'ideia lampada'], ['🎯', 'meta alvo objetivo'], ['🏆', 'trofeu ranking premio'], ['🔔', 'aviso notificacao sino'],
    ['📢', 'anuncio marketing'], ['🧭', 'bussola navegacao'], ['🗺️', 'mapa rota'], ['📍', 'local endereco'],
  ] },
  { nome: 'Pessoas', icones: [
    ['👤', 'usuario pessoa'], ['👥', 'usuarios clientes equipe'], ['👨‍💼', 'vendedor executivo'], ['👩‍💼', 'vendedora executiva'],
    ['🧑‍💻', 'programador ti suporte'], ['🧑‍🔧', 'tecnico manutencao'], ['👷', 'obra operario'], ['🧑‍⚕️', 'saude medico'],
    ['🧑‍🏫', 'treinamento professor'], ['🤝', 'parceria acordo negocio'], ['🙋', 'atendimento'], ['💁', 'recepcao informacao'],
    ['🧑‍🤝‍🧑', 'colaboradores rh'], ['👪', 'familia dependentes'], ['🪪', 'cracha documento identidade'], ['🎓', 'formacao curso'],
  ] },
  { nome: 'Financeiro', icones: [
    ['💰', 'dinheiro financeiro'], ['💵', 'dinheiro nota caixa'], ['💲', 'preco valor'], ['💳', 'cartao pagamento'],
    ['🏦', 'banco conta bancaria'], ['🪙', 'moeda'], ['💸', 'despesa pagar'], ['🧾', 'nota fiscal recibo'],
    ['📈', 'grafico alta vendas'], ['📉', 'grafico queda'], ['📊', 'grafico relatorio dashboard'], ['🧮', 'calculo contabil'],
    ['💹', 'investimento cotacao'], ['🏧', 'caixa eletronico'], ['🤑', 'lucro'], ['⚖️', 'balanco juridico'],
  ] },
  { nome: 'Comercial', icones: [
    ['🛒', 'carrinho vendas comercial'], ['🛍️', 'compras sacola'], ['🏷️', 'etiqueta preco produto'], ['📦', 'caixa produto estoque'],
    ['🎁', 'brinde presente'], ['🤝', 'negociacao contrato'], ['📝', 'proposta pedido'], ['📄', 'documento contrato'],
    ['📃', 'pagina orcamento'], ['🗒️', 'anotacao'], ['📣', 'campanha marketing'], ['💼', 'maleta negocios crm'],
    ['🎫', 'ticket cupom'], ['🧲', 'leads captacao'], ['📞', 'telefone ligacao'], ['☎️', 'telefone sac'],
  ] },
  { nome: 'Logística', icones: [
    ['🚚', 'caminhao entrega logistica'], ['🚛', 'carreta transporte'], ['🚐', 'van'], ['🚗', 'carro veiculo frota'],
    ['🏍️', 'moto motoboy'], ['✈️', 'aviao viagem'], ['🚢', 'navio importacao'], ['🛣️', 'estrada rota'],
    ['⛽', 'combustivel posto'], ['🏗️', 'construcao obra'], ['🏚️', 'deposito galpao'], ['📥', 'entrada recebimento'],
    ['📤', 'saida expedicao'], ['🗃️', 'arquivo estoque'], ['🧰', 'caixa ferramentas'], ['🪜', 'escada almoxarifado'],
  ] },
  { nome: 'Documentos', icones: [
    ['📋', 'cadastro lista prancheta'], ['📁', 'pasta'], ['📂', 'pasta aberta'], ['🗂️', 'divisoria categorias'],
    ['📑', 'abas documentos'], ['📚', 'livros documentacao'], ['📖', 'manual'], ['📒', 'caderno'],
    ['🖨️', 'impressora imprimir'], ['✏️', 'editar lapis'], ['🖊️', 'caneta assinatura'], ['📎', 'anexo clipe'],
    ['📌', 'fixar'], ['🗓️', 'agenda'], ['📅', 'calendario data'], ['📆', 'calendario mes'],
    ['⏰', 'alarme prazo'], ['⏳', 'ampulheta pendente'], ['🕒', 'relogio hora ponto'], ['✉️', 'email carta'],
    ['📧', 'email'], ['📨', 'mensagem recebida'], ['💬', 'chat conversa'], ['🗨️', 'comentario'],
  ] },
  { nome: 'Segurança', icones: [
    ['🔒', 'cadeado seguranca'], ['🔓', 'desbloqueado'], ['🔑', 'chave acesso senha'], ['🗝️', 'chave antiga'],
    ['🛡️', 'escudo protecao'], ['👁️', 'visualizar'], ['🚫', 'proibido bloqueado'], ['⚠️', 'atencao alerta'],
    ['✅', 'ok aprovado'], ['❌', 'cancelado erro'], ['❗', 'importante'], ['❓', 'ajuda duvida'],
    ['ℹ️', 'informacao'], ['🆕', 'novo'], ['🔄', 'atualizar sincronizar'], ['♻️', 'reciclar'],
  ] },
  { nome: 'Cores', icones: [
    ['🔴', 'vermelho'], ['🟠', 'laranja'], ['🟡', 'amarelo'], ['🟢', 'verde'],
    ['🔵', 'azul'], ['🟣', 'roxo'], ['🟤', 'marrom'], ['⚫', 'preto'], ['⚪', 'branco'],
    ['🟥', 'quadrado vermelho'], ['🟧', 'quadrado laranja'], ['🟨', 'quadrado amarelo'], ['🟩', 'quadrado verde'],
    ['🟦', 'quadrado azul'], ['🟪', 'quadrado roxo'], ['⬛', 'quadrado preto'], ['➕', 'mais adicionar'],
    ['🔶', 'losango'], ['🔷', 'losango azul'], ['💎', 'diamante premium'],
  ] },
  { nome: 'Outros', icones: [
    ['🏥', 'hospital saude'], ['💊', 'remedio farmacia'], ['🍽️', 'restaurante refeicao'], ['☕', 'cafe'],
    ['🌱', 'planta agro'], ['🌾', 'agricultura'], ['🐄', 'pecuaria'], ['⚡', 'energia eletrica'],
    ['💧', 'agua'], ['🔥', 'fogo destaque'], ['🌎', 'mundo exportacao'], ['🇧🇷', 'brasil'],
    ['🎨', 'design arte'], ['📷', 'foto camera'], ['🎥', 'video'], ['🎵', 'musica'],
    ['🧪', 'laboratorio teste'], ['🔬', 'qualidade analise'], ['🧹', 'limpeza'], ['🗑️', 'lixeira excluir'],
  ] },
];

// Ícone no começo do nome (emoji com variações / ZWJ / bandeira), seguido de espaços
const ICONE_INICIAL = /^(?:[\u{1F1E6}-\u{1F1FF}]{2}|\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}]|‍\p{Extended_Pictographic}️?)*)\s*/u;

const ui = {
  btn: document.getElementById('btnIconPicker'),
  search: document.getElementById('msIconSearch'),
  preview: document.getElementById('msIconPreview'),
  tabs: document.getElementById('msIconTabs'),
  grid: document.getElementById('msIconGrid'),
  empty: document.getElementById('msIconEmpty'),
  remove: document.getElementById('msIconRemove'),
};

let categoriaAtiva = CATEGORIAS[0].nome;

function normalizar(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function separarNome(nome) {
  const match = String(nome || '').match(ICONE_INICIAL);
  return match
    ? { icone: match[0].trim(), texto: nome.slice(match[0].length) }
    : { icone: '', texto: String(nome || '') };
}

function aplicarIcone(icone) {
  const { texto } = separarNome(elements.name.value.trim());
  elements.name.value = icone ? `${icone} ${texto}`.trim() : texto;
  elements.name.dispatchEvent(new Event('input', { bubbles: true }));
}

function atualizarPreview() {
  ui.preview.textContent = elements.name.value.trim() || 'Novo módulo';
}

function renderTabs() {
  ui.tabs.replaceChildren(...CATEGORIAS.map(({ nome }) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = `ms-icons-tab${nome === categoriaAtiva ? ' is-active' : ''}`;
    tab.textContent = nome;
    tab.addEventListener('click', () => {
      categoriaAtiva = nome;
      ui.search.value = '';
      render();
    });
    return tab;
  }));
}

function renderGrid() {
  const termo = normalizar(ui.search.value.trim());
  const atual = separarNome(elements.name.value.trim()).icone;
  const vistos = new Set();

  const lista = termo
    ? CATEGORIAS.flatMap((c) => c.icones.filter(([, chaves]) => normalizar(`${chaves} ${c.nome}`).includes(termo)))
    : CATEGORIAS.find((c) => c.nome === categoriaAtiva).icones;

  const botoes = lista
    .filter(([icone]) => !vistos.has(icone) && vistos.add(icone))
    .map(([icone, chaves]) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `ms-icons-item${icone === atual ? ' is-current' : ''}`;
      item.textContent = icone;
      item.title = chaves;
      item.addEventListener('click', () => {
        aplicarIcone(icone);
        Modal.close(MODAL_ID);
      });
      return item;
    });

  ui.grid.replaceChildren(...botoes);
  ui.empty.hidden = botoes.length > 0;
}

function render() {
  ui.tabs.hidden = !!ui.search.value.trim();
  renderTabs();
  renderGrid();
  atualizarPreview();
}

function abrir() {
  ui.search.value = '';
  render();
  Modal.open(MODAL_ID, { focusSelector: '#msIconSearch' });
}

export function registrarSeletorIcones() {
  Modal.setup();
  ui.btn.addEventListener('click', abrir);
  ui.search.addEventListener('input', render);
  ui.remove.addEventListener('click', () => {
    aplicarIcone('');
    Modal.close(MODAL_ID);
  });
}
