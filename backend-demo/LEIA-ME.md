# Demonstração do ERP Infinity (backend-demo/)

Versão do ERP para clientes testarem, separada do Infinity da BH3.

- **Código:** esta pasta é uma cópia do `backend/` (como o `backend-consart/`).
  Melhorias feitas no Infinity precisam ser copiadas para cá.
  A cópia não traz dados nem chaves da BH3: ficaram de fora os XMLs antigos
  da BH3 (`public/painelNotasFiscais/xmlAntigasBh3`), os PDFs de notas
  (`public/pdfs`), os anexos de e-mail (`public/email_attachments`),
  `config/credenciais-gcs.json`, `svc.yaml` (tinha a senha do banco),
  `sshTunnel.html` e backups.
- **Serviço:** `erp-demo` no Cloud Run, próprio, no mesmo projeto do Infinity.
  Endereço próprio (`https://erp-demo-….run.app`); depois dá para ligar um
  domínio, como `demo.consart.com.br` (Cloud Run > Gerenciar domínios).
- **Banco:** `erp-demo`, no mesmo servidor PostgreSQL do Infinity, criado vazio
  pelo `criar_banco_demo.ps1`: só a estrutura, as tabelas de referência (menu,
  perfis, IBGE, fiscais, plano de contas, etapas do CRM...) e o administrador
  da demo. Nenhum cliente, produto, nota, financeiro, usuário ou e-mail da BH3.
- **Variáveis:** secret `ENV_FILE_DEMO` (modelo em `modelo-env-demo.txt`):
  `JWT_SECRET` próprio, bucket próprio, NF-e simulada, sem chaves da BH3 e com
  e-mail e busca de notas na SEFAZ desligados.
- O rodapé mostra **DEMONSTRAÇÃO** no lugar dos botões BH3 / CONSART /
  LOGISTICS / PRODNEX.
- O `deploy.ps1` desta pasta nunca leva Logistics/ProdNex/Consart junto.

## Passo a passo (uma vez)

1. **Banco.** No PC, com o cliente do PostgreSQL instalado, nesta pasta:

   ```powershell
   .\criar_banco_demo.ps1
   ```

   Ele pede a senha do `postgres` e a senha do administrador da demo
   (login `contato@consart.com.br` ou `admin.demo`). O banco do Infinity só é
   lido. Se o servidor do banco não for o `34.45.142.53`, informe
   `-DbHost <endereço>` (o mesmo `DB_HOST` do `.env` do Infinity).

2. **Bucket.** No Cloud Storage, crie um bucket só da demo (ex.:
   `erp-demo-arquivos`, mesma região do serviço). A conta do Cloud Run precisa
   de acesso a ele (a mesma permissão que tem nos buckets do Infinity).

3. **Secret.** Monte o `.env` da demo seguindo o `modelo-env-demo.txt`
   (copie o `backend/.env`, troque `DEPLOY_SERVICE`, `DB_NAME`, `JWT_SECRET`,
   buckets, NF-e e empresa, e apague as chaves da lista). Crie o secret
   `ENV_FILE_DEMO` em GitHub > Settings > Secrets and variables > Actions.

4. **Deploy.** Actions > **Deploy Cloud Run** > Run workflow, pasta
   **backend-demo**, modo **completo**, demais campos vazios. Na primeira vez
   ele cria o serviço `erp-demo`.

5. **Testar.** Abra o endereço do serviço (aparece no fim do log do deploy e
   no Cloud Run) e entre com o administrador da demo.

Depois disso, para publicar mudanças na demo: **Deploy arquivos** com pasta
`backend-demo` (ou Deploy Cloud Run pasta `backend-demo`, modo so-codigo).

## Refazer o banco da demo (zerar)

Apague o banco `erp-demo` e rode o `criar_banco_demo.ps1` de novo. Dá para
mudar a lista de tabelas que vão com dados em `$TabelasReferencia`, no começo
do script.
