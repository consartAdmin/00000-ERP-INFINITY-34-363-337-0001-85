# Demonstração do ERP Infinity (/demo)

Versão do ERP para clientes testarem, em `https://erp.consart.com.br/demo`.

- **Código:** o mesmo do `backend/`. O `start.js` sobe uma segunda cópia do
  Infinity na porta 8084, no mesmo serviço do Cloud Run (como Logistics,
  ProdNex e Consart). Toda melhoria publicada no Infinity já aparece na demo.
- **Banco:** `erp-demo`, na mesma instância de banco do Infinity, criado vazio
  pelo `criar_banco_demo.ps1`: só a estrutura, as tabelas de referência (menu,
  perfis, IBGE, fiscais, plano de contas, etapas do CRM...) e o administrador
  da demo. Nenhum cliente, produto, nota, financeiro, usuário ou e-mail da BH3.
- **Variáveis:** secret `ENV_FILE_DEMO` (modelo em `modelo-env-demo.txt`),
  aplicadas com o prefixo `DEMO__` no deploy completo.
- Na demo ficam sempre desligados o recebimento de e-mails e a busca de notas
  na SEFAZ (`start.js`), e a NF-e fica simulada (`modelo-env-demo.txt`).
- O rodapé mostra **DEMONSTRAÇÃO** no lugar dos botões BH3 / CONSART /
  LOGISTICS / PRODNEX.

Esta pasta guarda só o script do banco e o modelo do `.env`. O `.env` de
verdade (`backend-demo/.env`) nunca vai para o git; no GitHub ele vem do secret.

## Passo a passo (uma vez)

1. **Banco.** No PC, com o cliente do PostgreSQL instalado, nesta pasta:

   ```powershell
   .\criar_banco_demo.ps1
   ```

   Ele pede a senha do `postgres` e a senha do administrador da demo
   (login `contato@consart.com.br` ou `admin.demo`). O banco do Infinity só é lido.

2. **Bucket.** No Cloud Storage, crie um bucket só da demo (ex.:
   `erp-demo-arquivos`, mesma região do serviço). A conta do Cloud Run precisa
   de acesso a ele (a mesma permissão que tem nos buckets do Infinity).

3. **Secret.** Monte o `.env` da demo seguindo o `modelo-env-demo.txt`
   (copie o `backend/.env`, troque `DB_NAME`, `JWT_SECRET`, buckets, NF-e e
   empresa, e apague as chaves da lista). Crie o secret `ENV_FILE_DEMO` em
   GitHub > Settings > Secrets and variables > Actions.

4. **Deploy.** Actions > **Deploy Cloud Run** > Run workflow, modo
   **completo**, campos vazios. A memória do serviço sobe para 3 GiB (são 5
   sistemas no mesmo contêiner).

5. **Ligar a rota.** O `start.js` define sozinho o `DEMO_URL` do Infinity
   quando há `DEMO__DB_NAME`; não precisa mexer no console.

6. **Testar.** Abra `https://erp.consart.com.br/demo/`
   (vai para a tela de login da demo) e entre com o
   administrador da demo.

Depois disso, o **Deploy arquivos** com pasta `backend` publica para o
Infinity e para a demo ao mesmo tempo.

## Refazer o banco da demo (zerar)

Apague o banco `erp-demo` (Cloud SQL > Bancos de dados) e rode o
`criar_banco_demo.ps1` de novo. Dá para mudar a lista de tabelas que vão com
dados em `$TabelasReferencia`, no começo do script.
