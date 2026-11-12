# ╔════════════════════════════════════════════════════════════╗
# ║ 🚀 deploy.ps1 — ERPConsart Cloud Run Deploy                ║
# ║ - Lê .env                                                  ║
# ║ - Separa DEPLOY_* de envs da aplicação                     ║
# ║ - Gera YAML temporário de env vars                         ║
# ║ - Deploy Cloud Run                                         ║
# ║                                                            ║
# ║ Uso:                                                       ║
# ║   .\deploy.ps1                          (usa .env)         ║
# ║   .\deploy.ps1 -EnvFile .env.00001      (outro cliente)    ║
# ║   .\deploy.ps1 -ImageOnly               (só código)        ║
# ║     -> mantém envs, segredos e recursos do serviço         ║
# ║   .\deploy.ps1 -Projetos logistics,prodnex,consart         ║
# ║     -> leva junto backend-logistics/, backend-prodnex/ e   ║
# ║        backend-consart/ (cada um com o próprio .env/banco) ║
# ║        no mesmo serviço; ver start.js                      ║
# ║ Senhas que o serviço lê do Secret Manager continuam lá     ║
# ║ (o valor do .env para essas chaves é ignorado).            ║
# ╚════════════════════════════════════════════════════════════╝

[CmdletBinding()]
param(
  [string]$EnvFile = "",
  [switch]$ImageOnly,
  [string]$Project = "",
  [string]$Service = "",
  [string]$Region = "",
  # Projetos que vão na mesma imagem (vazio = DEPLOY_PROJETOS do .env; "nenhum" = só o Infinity)
  [string[]]$Projetos = @()
)

$ErrorActionPreference = "Stop"

# Variáveis do PowerShell ignoram maiúsculas: $PROJECT (abaixo) sobrescreveria -Project
$ArgProject = $Project
$ArgService = $Service
$ArgRegion  = $Region

function Resolve-DotEnvPath {
  if ($EnvFile) {
    if (-not (Test-Path -Path $EnvFile)) { throw "❌ Arquivo não encontrado: $EnvFile" }
    return (Resolve-Path $EnvFile).Path
  }
  $candidates = @(".env", "backend/.env", "../backend/.env")
  foreach ($p in $candidates) {
    if (Test-Path -Path $p) { return (Resolve-Path $p).Path }
  }
  return $null
}

function Invoke-GcloudQuiet {
  # PS 5.1: stderr de comando nativo + "Stop" vira exceção; recurso inexistente é esperado aqui.
  # Retorna a saída (stdout) ou $null se o gcloud falhar.
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $out = $(& gcloud @args 2>$null)
    if ($LASTEXITCODE -ne 0 -or -not $out) { return $null }
    return $out
  } finally {
    $ErrorActionPreference = $prev
  }
}

function Invoke-Gcloud([string]$label) {
  # Executa o gcloud e aborta o deploy se falhar
  & gcloud @args
  if ($LASTEXITCODE -ne 0) { throw "❌ FALHA: $label" }
}

function Get-LiveService($svc, $proj, $reg) {
  # $null só quando o serviço não existe; qualquer outra falha aborta, senão o
  # deploy seguiria como "serviço novo" (sem trava de DB_NAME e sem preservar segredos)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $out = @(& gcloud run services describe $svc "--project=$proj" "--region=$reg" "--format=json" 2>&1)
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prev
  }

  $errText = ($out | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] } | ForEach-Object { $_.ToString() }) -join "`n"
  $json = ($out | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] }) -join "`n"

  if ($code -eq 0 -and $json) { return ($json | ConvertFrom-Json) }
  if ($errText -match 'Cannot find service|could not be found|NOT_FOUND') { return $null }
  throw "❌ Falha ao consultar o serviço $svc no Cloud Run (exit $code):`n$errText"
}

function ConvertTo-EnvValue([string]$value) {
  if ($null -eq $value) { return $null }

  $v = $value.Trim()

  # Valor entre aspas: pega até a aspa de fechamento; o que vier depois (ex.: comentário) é ignorado
  if ($v.StartsWith('"') -or $v.StartsWith("'")) {
    $quote = $v.Substring(0, 1)
    $close = $v.IndexOf($quote, 1)
    if ($close -gt 0) { return $v.Substring(1, $close - 1) }
  }

  $hashPos = $v.IndexOf(" #")
  if ($hashPos -ge 0) {
    $v = $v.Substring(0, $hashPos).Trim()
  }

  return $v
}

function Import-DotEnv($path) {
  $map = [ordered]@{}

  Get-Content $path -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()

    if ([string]::IsNullOrWhiteSpace($line)) { return }
    if ($line.StartsWith("#")) { return }

    $eq = $line.IndexOf("=")
    if ($eq -lt 1) { return }

    $k = $line.Substring(0, $eq).Trim()
    $v = $line.Substring($eq + 1).Trim()

    if ($k -notmatch '^[_A-Za-z][_A-Za-z0-9]*$') { return }

    $map[$k] = ConvertTo-EnvValue $v
  }

  return $map
}

function Write-EnvYaml($envMap, $outFile) {
  $lines = @()

  foreach ($k in $envMap.Keys) {
    $v = [string]$envMap[$k]
    $escaped = $v.Replace("'", "''")
    $lines += "${k}: '$escaped'"
  }

  Set-Content -Path $outFile -Value ($lines -join "`n") -Encoding UTF8
}

# ╔════════════════════════════════════════════════════════════╗
# ║ Outros projetos no mesmo serviço (start.js sobe cada um)   ║
# ╚════════════════════════════════════════════════════════════╝

$PROJETOS_CONHECIDOS = [ordered]@{
  logistics = @{ Pasta = "backend-logistics"; Prefixo = "LOGISTICS" }
  prodnex   = @{ Pasta = "backend-prodnex";   Prefixo = "PRODNEX" }
  consart   = @{ Pasta = "backend-consart";   Prefixo = "CONSART" }
}

# Chaves que nunca passam para o projeto (o start.js define ou o Infinity controla)
$PROJETO_ENV_IGNORADAS = @(
  "PORT", "K_SERVICE", "K_REVISION", "K_CONFIGURATION",
  "GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_CLOUD_PROJECT", "CLOUD_RUN_REGION",
  "APP_BASE_PATH", "LOGISTICA_DEMO_URL", "PRODNEX_URL", "CONSART_URL",
  "ENABLE_EMAIL_INBOUND", "ENABLE_DFE_SCHEDULER"
)

$REPO_ROOT = Split-Path -Parent $PSScriptRoot
$APPS_DIR = Join-Path $PSScriptRoot "apps"

function Resolve-Projetos([string[]]$lista, $deployMap) {
  $nomes = @($lista | ForEach-Object { $_ -split "," } | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ })
  if ($nomes.Count -eq 0 -and $deployMap.Contains("DEPLOY_PROJETOS")) {
    $nomes = @(([string]$deployMap["DEPLOY_PROJETOS"]) -split "," | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ })
  }
  if ($nomes -contains "nenhum") { return @() }
  foreach ($n in $nomes) {
    if (-not $PROJETOS_CONHECIDOS.Contains($n)) {
      throw "❌ Projeto desconhecido: $n (use $($PROJETOS_CONHECIDOS.Keys -join ', ') ou nenhum)."
    }
  }
  return $nomes
}

function Copy-Projetos([string[]]$nomes) {
  # Só arquivos versionados no git: .env, chaves e dados locais nunca entram na imagem
  if (Test-Path $APPS_DIR) { Remove-Item $APPS_DIR -Recurse -Force }
  foreach ($n in $nomes) {
    $pasta = $PROJETOS_CONHECIDOS[$n].Pasta
    try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
    $files = @(& git -C $REPO_ROOT -c core.quotepath=off ls-files -- $pasta)
    if ($LASTEXITCODE -ne 0) { throw "❌ git ls-files falhou para $pasta (o git está instalado?)." }
    if (-not ($files -contains "$pasta/server.js")) { throw "❌ $pasta/server.js não encontrado no repositório." }

    Write-Host "[PROJETOS] apps/$n <- $pasta ($($files.Count) arquivos)"
    foreach ($f in $files) {
      $src = Join-Path $REPO_ROOT $f
      if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { continue } # apagado e não commitado
      $dst = Join-Path (Join-Path $APPS_DIR $n) $f.Substring($pasta.Length + 1)
      $dir = Split-Path -Parent $dst
      if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
      Copy-Item -LiteralPath $src -Destination $dst -Force
    }
  }
}

function Invoke-Build([string]$image, [string]$project, [string[]]$nomes) {
  try {
    if ($nomes.Count -gt 0) { Copy-Projetos $nomes }
    gcloud builds submit --tag $image --project $project
    if ($LASTEXITCODE -ne 0) { throw "❌ BUILD FAILURE" }
  } finally {
    if (Test-Path $APPS_DIR) { Remove-Item $APPS_DIR -Recurse -Force -ErrorAction SilentlyContinue }
  }
}

function ConvertTo-Mi([string]$mem) {
  if ($mem -match '^(\d+)Gi$') { return [int]$Matches[1] * 1024 }
  if ($mem -match '^(\d+)Mi$') { return [int]$Matches[1] }
  if ($mem -match '^(\d+)G$')  { return [int]$Matches[1] * 1000 }
  if ($mem -match '^(\d+)M$')  { return [int]$Matches[1] }
  return 0
}

# Variáveis de cada projeto: só o que difere do Infinity, com prefixo (CONSART__DB_NAME=...)
function Add-EnvProjetos($appEnv, [string[]]$nomes) {
  foreach ($n in $nomes) {
    $p = $PROJETOS_CONHECIDOS[$n]
    $envPath = Join-Path (Join-Path $REPO_ROOT $p.Pasta) ".env"
    if (-not (Test-Path -LiteralPath $envPath)) {
      throw "❌ $($p.Pasta)/.env não encontrado. No GitHub ele vem do secret ENV_FILE_$($p.Prefixo)."
    }
    $sub = Import-DotEnv $envPath
    $db = [string]$sub["DB_NAME"]
    if (-not $db) { throw "❌ $($p.Pasta)/.env sem DB_NAME." }
    if ($db -eq [string]$appEnv["DB_NAME"]) { throw "❌ $($p.Pasta)/.env usa o mesmo banco do Infinity ($db)." }

    $pre = "$($p.Prefixo)__"
    foreach ($k in @($appEnv.Keys)) { if ($k.StartsWith($pre)) { $appEnv.Remove($k) } }

    $diff = 0
    foreach ($k in $sub.Keys) {
      if ($k.StartsWith("DEPLOY_") -or $PROJETO_ENV_IGNORADAS -contains $k) { continue }
      if (-not $appEnv.Contains($k) -or [string]$appEnv[$k] -ne [string]$sub[$k]) {
        $appEnv["$pre$k"] = $sub[$k]
        $diff++
      }
    }
    $unset = @($appEnv.Keys | Where-Object {
      -not $_.Contains("__") -and -not $sub.Contains($_) -and -not ($PROJETO_ENV_IGNORADAS -contains $_)
    })
    if ($unset.Count -gt 0) { $appEnv["${pre}UNSET"] = $unset -join "," }
    Write-Host "[PROJETOS] $n`: DB_NAME=$db, $diff variáveis próprias, $($unset.Count) do Infinity removidas"
  }
}

$DotEnvPath = Resolve-DotEnvPath
if ($DotEnvPath) {
  Write-Host "[INFO] Usando .env em: $DotEnvPath"
  $ENVALL = Import-DotEnv $DotEnvPath
} elseif ($ImageOnly) {
  $ENVALL = [ordered]@{}
} else {
  throw "❌ Arquivo .env não encontrado."
}

$DEPLOY = [ordered]@{}
$APPENV = [ordered]@{}

# ╔════════════════════════════════════════════════════════════╗
# ║ Separação segura: DEPLOY_* x variáveis da aplicação       ║
# ║ IMPORTANTE: Cloud Run reserva PORT e injeta automaticamente║
# ╚════════════════════════════════════════════════════════════╝

$RESERVED_CLOUD_RUN_ENVS = @(
  "PORT",
  "K_SERVICE",
  "K_REVISION",
  "K_CONFIGURATION"
)

foreach ($k in $ENVALL.Keys) {
  if ($k.StartsWith("DEPLOY_")) {
    $DEPLOY[$k] = $ENVALL[$k]
    continue
  }

  if ($RESERVED_CLOUD_RUN_ENVS -contains $k) {
    Write-Host "[ENV] Ignorando variável reservada do Cloud Run: $k" -ForegroundColor Yellow
    continue
  }

  # Caminho da chave no Windows: não existe no container e quebra o `new Storage()`.
  # No Cloud Run o acesso ao bucket vem da service account do serviço (ver deploy-bucket.ps1).
  if ($k -eq "GOOGLE_APPLICATION_CREDENTIALS") {
    Write-Host "[ENV] Ignorando variável só local: $k" -ForegroundColor Yellow
    continue
  }

  $APPENV[$k] = $ENVALL[$k]
}

$PROJECT             = $DEPLOY["DEPLOY_PROJECT"]
$REGION              = $DEPLOY["DEPLOY_REGION"]
$SERVICE             = $DEPLOY["DEPLOY_SERVICE"]
$MIN_INST            = $DEPLOY["DEPLOY_MIN_INSTANCES"]
$MAX_INST            = $DEPLOY["DEPLOY_MAX_INSTANCES"]
$CPU                 = $DEPLOY["DEPLOY_CPU"]
$MEMORY              = $DEPLOY["DEPLOY_MEMORY"]
$TIMEOUT             = $DEPLOY["DEPLOY_TIMEOUT"]
$PORT                = $DEPLOY["DEPLOY_PORT"]
$CONCURRENCY         = $DEPLOY["DEPLOY_CONCURRENCY"]
$CONNECTOR_NAME      = $DEPLOY["DEPLOY_CONNECTOR_NAME"]
$VPC_NETWORK         = $DEPLOY["DEPLOY_VPC_NETWORK"]
$VPC_RANGE           = $DEPLOY["DEPLOY_VPC_RANGE"]
$ROUTER_NAME         = $DEPLOY["DEPLOY_ROUTER_NAME"]
$NAT_NAME            = $DEPLOY["DEPLOY_NAT_NAME"]
$ACCOUNT             = $DEPLOY["DEPLOY_ACCOUNT"]
$IMAGE_REPO          = $DEPLOY["DEPLOY_IMAGE_REPO"]

# Conta do gcloud usada neste deploy (vale só para este processo do PowerShell)
if ($ACCOUNT) {
  $env:CLOUDSDK_CORE_ACCOUNT = $ACCOUNT
  Write-Host "[INFO] ACCOUNT = $ACCOUNT"
}

if ($ArgProject) { $PROJECT = $ArgProject }
if ($ArgService) { $SERVICE = $ArgService }
if ($ArgRegion)  { $REGION  = $ArgRegion }
if ($ImageOnly -and -not $REGION) { $REGION = "us-central1" }

if (-not $PROJECT -or -not $REGION -or -not $SERVICE) {
  throw "❌ Informe DEPLOY_PROJECT, DEPLOY_REGION e DEPLOY_SERVICE no .env."
}

$PROJETOS_SEL = @(Resolve-Projetos $Projetos $DEPLOY)
if ($PROJETOS_SEL.Count -gt 0) {
  Write-Host "[INFO] PROJETOS = $($PROJETOS_SEL -join ', ') (mesmo serviço, ver start.js)"
}

# Projeto do gcloud só para este processo (não altera o `gcloud config` global)
$env:CLOUDSDK_CORE_PROJECT = $PROJECT

# ╔════════════════════════════════════════════════════════════╗
# ║ Modo -ImageOnly: builda e publica só o código.             ║
# ║ Envs, segredos, CPU/memória e VPC da revisão atual ficam.  ║
# ╚════════════════════════════════════════════════════════════╝

if ($ImageOnly) {
  $live = Get-LiveService $SERVICE $PROJECT $REGION
  if (-not $live) {
    throw "❌ Serviço $SERVICE não encontrado em $PROJECT/$REGION. -ImageOnly só atualiza serviços existentes."
  }

  $repository = [string]$live.spec.template.spec.containers[0].image
  $digestAt = $repository.IndexOf("@sha256:")
  if ($digestAt -ge 0) {
    $repository = $repository.Substring(0, $digestAt)
  } else {
    $lastSlash = $repository.LastIndexOf("/")
    $lastColon = $repository.LastIndexOf(":")
    if ($lastColon -gt $lastSlash) { $repository = $repository.Substring(0, $lastColon) }
  }
  $IMAGE = $repository + ":build-" + (Get-Date).ToString("yyyyMMdd-HHmmss")

  Write-Host ""
  Write-Host "[INFO] MODO    = ImageOnly (envs e segredos preservados)"
  Write-Host "[INFO] PROJECT = $PROJECT"
  Write-Host "[INFO] REGION  = $REGION"
  Write-Host "[INFO] SERVICE = $SERVICE"
  Write-Host "[INFO] IMAGE   = $IMAGE"

  $extra = @()
  if ($PROJETOS_SEL.Count -gt 0) {
    $liveEnvNames = @($live.spec.template.spec.containers[0].env | ForEach-Object { $_.name })
    foreach ($n in $PROJETOS_SEL) {
      $pre = $PROJETOS_CONHECIDOS[$n].Prefixo
      if (-not ($liveEnvNames -contains "${pre}__DB_NAME")) {
        Write-Host "[PROJETOS] $n ainda sem ${pre}__DB_NAME no serviço: só sobe depois de um deploy completo." -ForegroundColor Yellow
      }
    }
    $liveMem = [string]$live.spec.template.spec.containers[0].resources.limits.memory
    if ((ConvertTo-Mi $liveMem) -lt 2048) {
      Write-Host "[PROJETOS] Memória $liveMem -> 2Gi (4 projetos no mesmo contêiner)" -ForegroundColor Yellow
      $extra = @("--memory", "2Gi")
    }
  }

  Write-Host ""
  Write-Host "[BUILD] Enviando build para o Cloud Build..."
  Invoke-Build $IMAGE $PROJECT $PROJETOS_SEL

  Write-Host ""
  Write-Host "[DEPLOY] Publicando nova imagem..."
  gcloud run deploy $SERVICE --image $IMAGE --project $PROJECT --region $REGION --quiet @extra
  if ($LASTEXITCODE -ne 0) { throw "❌ DEPLOY FAILURE" }

  Write-Host ""
  Write-Host "✅ Deploy (ImageOnly) concluído: $SERVICE"
  return
}

# ╔════════════════════════════════════════════════════════════╗
# ║ Trava de segurança: o .env precisa ser do serviço destino  ║
# ╚════════════════════════════════════════════════════════════╝

$envDbName = [string]$APPENV["DB_NAME"]
$live = Get-LiveService $SERVICE $PROJECT $REGION

if ($live) {
  $liveEnv = @($live.spec.template.spec.containers[0].env)

  $liveDbEntry = $liveEnv | Where-Object { $_.name -eq "DB_NAME" } | Select-Object -First 1
  $liveDbName = [string]$liveDbEntry.value
  if (-not $envDbName) {
    Write-Host "[TRAVA] DB_NAME ausente no arquivo: conferência de cliente não realizada." -ForegroundColor Yellow
  } elseif ($liveDbEntry -and $liveDbEntry.valueFrom) {
    Write-Host "[TRAVA] DB_NAME do serviço vem do Secret Manager: conferência de cliente não realizada." -ForegroundColor Yellow
  }
  if ($liveDbName -and $envDbName -and $liveDbName -ne $envDbName) {
    throw "❌ TRAVA: $SERVICE usa DB_NAME=$liveDbName, mas o arquivo tem DB_NAME=$envDbName. Arquivo de outro cliente? Use -EnvFile correto."
  }

  # Chaves que o serviço lê do Secret Manager continuam vindo de lá:
  # não vão no YAML (o --env-vars-file só substitui as variáveis literais).
  $secretKeys = @($liveEnv | Where-Object { $_.valueFrom } | ForEach-Object { $_.name })
  $fromSecrets = @($secretKeys | Where-Object { $APPENV.Contains($_) })
  foreach ($k in $fromSecrets) { $APPENV.Remove($k) }
  if ($fromSecrets.Count -gt 0) {
    Write-Host "[SECRETS] $($fromSecrets.Count) variáveis mantidas do Secret Manager (valor do .env ignorado): $($fromSecrets -join ', ')" -ForegroundColor Yellow
  }
} elseif ($envDbName -and $envDbName -ne $SERVICE) {
  throw "❌ TRAVA: serviço novo $SERVICE com DB_NAME=$envDbName. Confira o arquivo."
}

if (-not $MIN_INST)            { $MIN_INST = "0" }
if (-not $MAX_INST)            { $MAX_INST = "1" }
if (-not $CPU)                 { $CPU = "1" }
if (-not $MEMORY)              { $MEMORY = "1Gi" }
if ($PROJETOS_SEL.Count -gt 0 -and (ConvertTo-Mi $MEMORY) -lt 2048) {
  Write-Host "[PROJETOS] DEPLOY_MEMORY=$MEMORY -> 2Gi (4 projetos no mesmo contêiner)" -ForegroundColor Yellow
  $MEMORY = "2Gi"
}

# Antes do build: falta de .env de um projeto aborta sem gastar o Cloud Build
if ($PROJETOS_SEL.Count -gt 0) { Add-EnvProjetos $APPENV $PROJETOS_SEL }
if (-not $TIMEOUT)             { $TIMEOUT = "300" }
if (-not $PORT)                { $PORT = "8080" }
if (-not $CONCURRENCY)         { $CONCURRENCY = "80" }

# Repositório: DEPLOY_IMAGE_REPO (projeto compartilhado) ou, se vazio, o padrão antigo = nome do serviço
if (-not $IMAGE_REPO) { $IMAGE_REPO = $SERVICE }
$IMAGE = "$REGION-docker.pkg.dev/$PROJECT/$IMAGE_REPO/${SERVICE}:" + (Get-Date).ToString("yyyyMMdd-HHmmss")
$ENV_YAML = Join-Path $env:TEMP "erpconsart-env-$SERVICE.yaml"

Write-Host ""
Write-Host "[INFO] PROJECT = $PROJECT"
Write-Host "[INFO] REGION  = $REGION"
Write-Host "[INFO] SERVICE = $SERVICE"
Write-Host "[INFO] IMAGE   = $IMAGE"

Write-Host ""
Write-Host "[APIs] Habilitando APIs necessárias..."

Invoke-Gcloud "habilitar APIs" services enable `
  run.googleapis.com `
  cloudbuild.googleapis.com `
  artifactregistry.googleapis.com `
  compute.googleapis.com `
  vpcaccess.googleapis.com `
  storage.googleapis.com `
  sqladmin.googleapis.com `
  --project $PROJECT | Out-Null

Write-Host ""
Write-Host "[ARTIFACT] Verificando repositório $IMAGE_REPO..."

$repo = Invoke-GcloudQuiet artifacts repositories describe $IMAGE_REPO `
  --location $REGION `
  --project $PROJECT `
  --format="value(name)"

if (-not $repo) {
  Write-Host "[ARTIFACT] Criando repositório $IMAGE_REPO..."
  Invoke-Gcloud "criar repositório $IMAGE_REPO" artifacts repositories create $IMAGE_REPO `
    --repository-format docker `
    --location $REGION `
    --project $PROJECT | Out-Null
}

if ($CONNECTOR_NAME -and $VPC_NETWORK -and $VPC_RANGE) {
  Write-Host ""
  Write-Host "[VPC ACCESS] Verificando conector..."

  $existing = Invoke-GcloudQuiet compute networks vpc-access connectors describe $CONNECTOR_NAME `
    --region $REGION `
    --project $PROJECT `
    --format="value(name)"

  if (-not $existing) {
    Invoke-Gcloud "criar conector $CONNECTOR_NAME" compute networks vpc-access connectors create $CONNECTOR_NAME `
      --region $REGION `
      --project $PROJECT `
      --network $VPC_NETWORK `
      --range $VPC_RANGE `
      --min-instances 2 `
      --max-instances 3 | Out-Null
  } else {
    Write-Host "[VPC ACCESS] Conector já existe."
  }

  Write-Host "[VPC ACCESS] Aguardando READY..."

  $state = $null
  for ($i = 0; $i -lt 60; $i++) {
    $state = Invoke-GcloudQuiet compute networks vpc-access connectors describe $CONNECTOR_NAME `
      --region $REGION `
      --project $PROJECT `
      --format="value(state)"

    if ($state -eq "READY") { break }

    Start-Sleep -Seconds 5
  }

  if ($state -ne "READY") {
    throw "❌ Conector $CONNECTOR_NAME não ficou READY em 5 minutos (estado: $state)."
  }
  Write-Host "[VPC ACCESS] READY"
}

if ($ROUTER_NAME -and $NAT_NAME -and $VPC_NETWORK) {
  Write-Host ""
  Write-Host "[NAT] Verificando Router e NAT..."

  $router = Invoke-GcloudQuiet compute routers describe $ROUTER_NAME `
    --region $REGION `
    --project $PROJECT `
    --format="value(name)"

  if (-not $router) {
    Invoke-Gcloud "criar router $ROUTER_NAME" compute routers create $ROUTER_NAME `
      --network $VPC_NETWORK `
      --region $REGION `
      --project $PROJECT | Out-Null
  }

  $nat = Invoke-GcloudQuiet compute routers nats describe $NAT_NAME `
    --router $ROUTER_NAME `
    --region $REGION `
    --project $PROJECT `
    --format="value(name)"

  if (-not $nat) {
    Invoke-Gcloud "criar NAT $NAT_NAME" compute routers nats create $NAT_NAME `
      --router $ROUTER_NAME `
      --region $REGION `
      --project $PROJECT `
      --nat-all-subnet-ip-ranges `
      --auto-allocate-nat-external-ips `
      --enable-logging | Out-Null
  }
}

Write-Host ""
Write-Host "[BUILD] Enviando build para o Cloud Build..."

Invoke-Build $IMAGE $PROJECT $PROJETOS_SEL

$APPENV["GOOGLE_CLOUD_PROJECT"] = $PROJECT
$APPENV["CLOUD_RUN_REGION"] = $REGION

# ✅ Cloud Run safe boot: impede listeners longos no startup
foreach ($k in @("ENABLE_EMAIL_INBOUND", "ENABLE_DFE_SCHEDULER")) {
  if ($APPENV.Contains($k) -and [string]$APPENV[$k] -ne "false") {
    Write-Host "[ENV] $k=$($APPENV[$k]) no .env sobrescrito para false (safe boot)" -ForegroundColor Yellow
  }
  $APPENV[$k] = "false"
}

Write-Host ""
Write-Host "[ENV] Gerando arquivo YAML temporário..."

try {
  Write-EnvYaml -envMap $APPENV -outFile $ENV_YAML

  Write-Host "[ENV] Arquivo: $ENV_YAML"

  Write-Host ""
  Write-Host "[DEPLOY] Publicando serviço no Cloud Run..."

  $cmd = @(
    "run", "deploy", $SERVICE,
    "--project", $PROJECT,
    "--image", $IMAGE,
    "--region", $REGION,
    "--allow-unauthenticated",
    "--port", $PORT,
    "--startup-probe", "tcpSocket.port=$PORT,periodSeconds=10,timeoutSeconds=10,failureThreshold=24",
    "--memory", $MEMORY,
    "--cpu", $CPU,
    "--no-cpu-throttling",
    "--concurrency", $CONCURRENCY,
    "--timeout", $TIMEOUT,
    "--min-instances", $MIN_INST,
    "--max-instances", $MAX_INST,
    "--env-vars-file", $ENV_YAML
  )

  if ($CONNECTOR_NAME) {
    $cmd += @("--vpc-connector", $CONNECTOR_NAME, "--vpc-egress", "all-traffic")
  }

  gcloud @cmd

  if ($LASTEXITCODE -ne 0) {
    throw "❌ DEPLOY FAILURE"
  }
} finally {
  # O YAML contém senhas em texto puro: remove mesmo se o deploy falhar
  Remove-Item $ENV_YAML -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "✅ Deploy concluído com sucesso."
Write-Host "[INFO] Serviço publicado: $SERVICE"
Write-Host "[INFO] Região: $REGION"
