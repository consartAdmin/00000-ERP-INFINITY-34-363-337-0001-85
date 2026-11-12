# ============================================================
# Cria o banco da DEMONSTRAÇÃO (rota /demo) a partir do banco do Infinity,
# SEM os dados da empresa:
#
#   1. copia só a ESTRUTURA (todas as tabelas, funções, índices e chaves);
#   2. copia os DADOS apenas das tabelas de referência listadas em
#      $TabelasReferencia (menu, perfis, IBGE, tabelas fiscais, tipos...);
#   3. cria o usuário administrador da demo, com acesso a todos os módulos.
#
# Clientes, fornecedores, produtos, estoque, notas, financeiro, usuários,
# e-mails, certificados e dados da empresa NÃO são copiados.
#
# O banco de origem só é LIDO. Se o banco destino já existir, o script para
# sem alterar nada.
#
# Uso (PowerShell, com pg_dump/pg_restore/createdb/psql do PostgreSQL no PATH):
#   .\criar_banco_demo.ps1
#   .\criar_banco_demo.ps1 -Destino erp-demo -AdminEmail contato@consart.com.br
# ============================================================
param(
  [string]$DbHost     = "34.45.142.53",
  [int]   $Porta      = 5432,
  [string]$Usuario    = "postgres",
  [string]$Origem     = "erp-infinity-00000",
  [string]$Destino    = "erp-demo",
  [string]$AdminNome  = "admin.demo",
  [string]$AdminEmail = "contato@consart.com.br"
)

$ErrorActionPreference = "Stop"

# Tabelas que vão COM dados (o resto vai vazio). Pode tirar ou incluir nomes:
# tabela que não existir no banco de origem é só ignorada.
$TabelasReferencia = @(
  # Sistema: menu, telas, perfis de acesso e rotinas que já rodaram
  "moduleSystem", "oneTimeJobs", "accessProfiles", "sessionTimeOutConfig",
  "appFeatures", "appFeatureOptions",
  # Localidades (IBGE)
  "ibgeLocations",
  # Fiscal de referência
  "nfeOperationTypes", "nfeStatusMap", "productsFiscalOrigins",
  "fiscalClassificationV2", "fiscalProfileV2",
  # Unidades e formas de pagamento
  "units", "tabelaUnidades", "paymentMethods", "cashDocumentTypes",
  # Financeiro: plano de contas e categorias
  "chartOfAccounts", "cashCategories", "cashSubcategories", "debtsTypes",
  # CRM e pedidos: etapas e motivos
  "crmDealsStages", "crmStagesReativation", "crmLossReasons", "crmLeadSources",
  "ordersKanbanColumns", "customerStatusTypes"
)

foreach ($cmd in "pg_dump", "pg_restore", "createdb", "psql") {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    throw "Não encontrei '$cmd'. Instale o cliente do PostgreSQL ou coloque a pasta bin dele no PATH."
  }
}
if ($Destino -eq $Origem) { throw "O banco destino não pode ser o mesmo da origem." }

function Ler-Senha([string]$texto) {
  $s = Read-Host $texto -AsSecureString
  return [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}

$env:PGPASSWORD = Ler-Senha "Senha do usuário $Usuario no banco $DbHost"
$adminSenha = Ler-Senha "Senha do administrador da demo ($AdminEmail)"
if ((Ler-Senha "Repita a senha do administrador da demo") -ne $adminSenha) { throw "As senhas do administrador não conferem." }
if ($adminSenha.Length -lt 8) { throw "Use uma senha de pelo menos 8 caracteres para o administrador da demo." }
if ($adminSenha.Contains('"')) { throw "A senha do administrador não pode ter aspas duplas." }

$tmp = Join-Path $env:TEMP ("erp-demo-" + (Get-Date).ToString("yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null

function Psql-Arquivo([string]$banco, [string]$sql, [switch]$ParaNoErro) {
  # SQL vai por arquivo: o PowerShell 5 tira as aspas duplas dos argumentos
  $arq = Join-Path $tmp ("q" + [guid]::NewGuid().ToString("N") + ".sql")
  [IO.File]::WriteAllText($arq, $sql, (New-Object Text.UTF8Encoding $false))
  $stop = if ($ParaNoErro) { "1" } else { "0" }
  $out = psql -h $DbHost -p $Porta -U $Usuario -d $banco -X -q -tA -v ON_ERROR_STOP=$stop -f $arq
  if ($ParaNoErro -and $LASTEXITCODE -ne 0) { throw "psql falhou no banco $banco." }
  Remove-Item $arq -ErrorAction SilentlyContinue
  return $out
}

try {
  $existe = psql -h $DbHost -p $Porta -U $Usuario -d postgres -X -tAc "SELECT 1 FROM pg_database WHERE datname = '$Destino'"
  if ($existe -eq "1") {
    throw "O banco '$Destino' já existe. Nada foi alterado. Apague-o antes, se quiser recriar."
  }

  # Só as tabelas de referência que existem na origem
  $lista = ($TabelasReferencia | ForEach-Object { "('" + $_.Replace("'", "''") + "')" }) -join ","
  $existentes = @(Psql-Arquivo $Origem "SELECT t FROM (VALUES $lista) v(t) WHERE to_regclass('public.' || quote_ident(t)) IS NOT NULL;" -ParaNoErro |
    Where-Object { $_ })
  $faltando = @($TabelasReferencia | Where-Object { $existentes -notcontains $_ })
  if ($faltando.Count -gt 0) { Write-Host "Tabelas de referência que não existem na origem (ignoradas): $($faltando -join ', ')" -ForegroundColor Yellow }

  $dump = Join-Path $tmp "estrutura.dump"
  Write-Host "1/6 Lendo a estrutura do banco $Origem (sem dados)..."
  pg_dump -h $DbHost -p $Porta -U $Usuario -Fc --schema-only --no-owner --no-privileges -f $dump $Origem
  if ($LASTEXITCODE -ne 0) { throw "pg_dump falhou." }

  Write-Host "2/6 Copiando os dados de $($existentes.Count) tabelas de referência..."
  $exportar = ($existentes | ForEach-Object {
    $csv = (Join-Path $tmp "$_.csv").Replace("\", "/")
    "\copy public.""$_"" TO '$csv' WITH (FORMAT csv, HEADER)"
  }) -join "`n"
  Psql-Arquivo $Origem $exportar -ParaNoErro | Out-Null

  Write-Host "3/6 Criando o banco $Destino..."
  createdb -h $DbHost -p $Porta -U $Usuario $Destino
  if ($LASTEXITCODE -ne 0) { throw "createdb falhou." }

  Write-Host "4/6 Criando as tabelas (vazias) e gravando as de referência..."
  pg_restore -h $DbHost -p $Porta -U $Usuario -d $Destino --no-owner --no-privileges --section=pre-data $dump
  if ($LASTEXITCODE -ne 0) { Write-Warning "pg_restore (tabelas) terminou com avisos (normalmente extensões ou permissões). Confira acima." }

  $importar = ($existentes | ForEach-Object {
    $csv = (Join-Path $tmp "$_.csv").Replace("\", "/")
    "\copy public.""$_"" FROM '$csv' WITH (FORMAT csv, HEADER)"
  }) -join "`n"
  Psql-Arquivo $Destino $importar -ParaNoErro | Out-Null

  # Sequências das tabelas copiadas continuam do maior id (as vazias começam do 1)
  Psql-Arquivo $Destino @'
DO $$
DECLARE r record; m bigint;
BEGIN
  FOR r IN
    SELECT s.oid::regclass AS seq, t.oid::regclass AS tab, a.attname AS col
      FROM pg_class s
      JOIN pg_depend d ON d.objid = s.oid AND d.deptype IN ('a', 'i')
      JOIN pg_class t ON t.oid = d.refobjid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE s.relkind = 'S' AND n.nspname = 'public'
  LOOP
    EXECUTE format('SELECT max(%I) FROM %s', r.col, r.tab) INTO m;
    IF m IS NOT NULL THEN PERFORM setval(r.seq, m, true); END IF;
  END LOOP;
END $$;
'@ -ParaNoErro | Out-Null

  Write-Host "5/6 Criando índices, chaves e gatilhos..."
  pg_restore -h $DbHost -p $Porta -U $Usuario -d $Destino --no-owner --no-privileges --section=post-data $dump
  if ($LASTEXITCODE -ne 0) { Write-Warning "pg_restore (índices/chaves) terminou com avisos. Uma chave estrangeira de tabela de referência que aponte para uma tabela vazia pode falhar; o resto segue normal." }

  # Views materializadas vêm sem conteúdo na cópia só de estrutura
  Psql-Arquivo $Destino @'
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT schemaname, matviewname FROM pg_matviews WHERE schemaname = 'public' LOOP
    BEGIN
      EXECUTE format('REFRESH MATERIALIZED VIEW %I.%I', r.schemaname, r.matviewname);
    EXCEPTION WHEN others THEN
      RAISE WARNING 'View % não atualizada: %', r.matviewname, SQLERRM;
    END;
  END LOOP;
END $$;
'@ | Out-Null

  Write-Host "6/6 Criando o administrador da demo ($AdminEmail)..."
  $seed = @'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
INSERT INTO public.users (name, email, password_hash, access_level, is_active)
VALUES (:'admin_nome', :'admin_email', crypt(:'admin_senha', gen_salt('bf', 10)), 'ADMINISTRADOR', true)
RETURNING user_id AS admin_id \gset
INSERT INTO public."userModules" (usuario_id, modulo_id, pode_acessar)
SELECT :admin_id, id, true FROM public."moduleSystem"
ON CONFLICT DO NOTHING;
INSERT INTO public."usersProfile" (usuario_id, modulo_id, profile, can_view, can_create, can_edit, can_delete, can_export)
SELECT :admin_id, id, 'ADMINISTRADOR', true, true, true, true, true FROM public."moduleSystem"
ON CONFLICT DO NOTHING;
'@
  $arq = Join-Path $tmp "admin.sql"
  [IO.File]::WriteAllText($arq, $seed, (New-Object Text.UTF8Encoding $false))
  psql -h $DbHost -p $Porta -U $Usuario -d $Destino -X -q -v ON_ERROR_STOP=1 `
    -v "admin_nome=$AdminNome" -v "admin_email=$AdminEmail" -v "admin_senha=$adminSenha" -f $arq
  if ($LASTEXITCODE -ne 0) { throw "Não consegui criar o administrador da demo. O banco $Destino ficou criado; confira a mensagem acima." }

  $tabelas = psql -h $DbHost -p $Porta -U $Usuario -d $Destino -X -tAc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'"
  Write-Host ""
  Write-Host "Pronto. Banco '$Destino' criado com $tabelas tabelas, $($existentes.Count) delas com dados de referência." -ForegroundColor Green
  Write-Host "Login da demo: $AdminEmail (ou $AdminNome) com a senha que você digitou."
}
finally {
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
