# Consart Starter — Frente de Caixa (Windows)

App Electron da frente de caixa (PDV) ligado ao Consart ERP (backend da BH3, rotas `/api/pdv`).

## Como instalar no caixa

1. No GitHub, abra **Actions → Gerar instalador PDV (Consart Starter) → Run workflow**.
2. Quando terminar, baixe **consart-starter-instalador** em *Artifacts* e rode o `.exe` no PC do caixa.
3. Na primeira abertura, informe o **endereço do ERP** (o mesmo do navegador), o nome do caixa (ex.: `CAIXA-01`), a loja e a impressora do cupom.
4. Entre com um usuário cadastrado em **Usuários do PDV** no ERP (`/pdv_logins`).

## O que faz

- Login com os usuários do PDV do ERP (token de 14 h).
- Abertura de caixa com fundo de troco, sangria (F6), suprimento (F7) e fechamento com conferência por forma de pagamento.
- Venda por leitor de código de barras, código do produto ou busca por nome; `3*código` vende 3 unidades; código de barras de caixa/fardo usa o fator da unidade.
- Pagamento com várias formas na mesma venda e troco calculado.
- Cupom não fiscal 80 mm na impressora escolhida.
- **Sem internet:** o catálogo fica salvo no PC e as vendas entram numa fila que é enviada ao ERP quando a conexão volta (sem duplicar). Para entrar sem internet, o operador precisa ter entrado pelo menos uma vez com internet neste PC. Abrir e fechar o caixa exige internet.

## Atalhos

| Tecla | Ação |
| --- | --- |
| F2 | Buscar produto |
| F3 | Quantidade do item selecionado |
| F4 | Desconto (item ou venda, valor ou %) |
| F5 | CPF/CNPJ na nota |
| F6 / F7 | Sangria / Suprimento |
| F10 | Pagamento |
| ↑ ↓ | Selecionar item (na venda) ou forma de pagamento |
| Del | Remover item |
| Esc | Cancelar venda / fechar janela |

## Desenvolvimento

```bash
cd pdv-desktop
npm install
npm start
```

Os dados locais ficam em `%APPDATA%/consart-starter-pdv/dados` (config, catálogo, fila de vendas e histórico).

## Próximas etapas

- Emissão de NFC-e (PlugNotas) a partir da venda.
- Cancelamento de venda com estorno de estoque.
- TEF/maquininha integrada, balança e gaveta.
