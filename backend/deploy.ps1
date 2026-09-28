# ╔════════════════════════════════════════════════════════════╗
# ║ 🚀 deploy.ps1 — ERPConsart Cloud Run Deploy                ║
# ║ - Lê .env                                                  ║
# ║ - Separa DEPLOY_* de envs da aplicação                     ║
# ║ - Gera YAML temporário de env vars                         ║
# ║ - Deploy Cloud Run                                         ║
# ║ - Cria/atualiza Scheduler com token                        ║
# ║                                                            ║
# ║ Uso:                                                       ║
# ║   .\deploy.ps1                          (usa .env)         ║
# ║   .\deploy.ps1 -EnvFile .env.00001      (outro cliente)    ║
# ║   .\deploy.ps1 -ImageOnly               (só código)        ║
# ║     -> mantém envs, segredos e recursos do serviço         ║
# ║ Senhas que o serviço lê do Secret Manager continuam lá     ║
# ║ (o valor do .env para essas chaves é ignorado).            ║
# ╚════════════════════════════════════════════════════════════╝

[CmdletBinding()]
param(
  [string]$EnvFile = "",
  [switch]$ImageOnly,
  [string]$Project = "",
  [string]$Service = "",
  [string]$Region = ""
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

function Get-LiveService($svc, $proj, $reg) {
  # PS 5.1: stderr de comando nativo + "Stop" vira exceção; serviço inexistente é esperado aqui
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $json = $(gcloud run services describe $svc --project=$proj --region=$reg --format=json 2>$null)
    if ($LASTEXITCODE -ne 0 -or -not $json) { return $null }
    return ($json | Out-String | ConvertFrom-Json)
  } finally {
    $ErrorActionPreference = $prev
  }
}

function ConvertTo-EnvValue([string]$value) {
  if ($null -eq $value) { return $null }

  $v = $value.Trim()

  if (
    ($v.StartsWith('"') -and $v.EndsWith('"')) -or
    ($v.StartsWith("'") -and $v.EndsWith("'"))
  ) {
    $v = $v.Substring(1, $v.Length - 2).Trim()
  }

  $hashPos = $v.IndexOf(" #")
  if ($hashPos -ge 0) {
    $v = $v.Substring(0, $hashPos).Trim()
  }

  return $v
}

function Import-DotEnv($path) {
  $map = [ordered]@{}

  Get-Content $path | ForEach-Object {
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
$BASE_URL            = $DEPLOY["DEPLOY_BASE_URL"]
$SCHEDULER_LOCATION  = $DEPLOY["DEPLOY_SCHEDULER_LOCATION"]
$TIMEZONE            = $DEPLOY["DEPLOY_SCHEDULER_TIMEZONE"]
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

  Write-Host ""
  Write-Host "[BUILD] Enviando build para o Cloud Build..."
  gcloud builds submit --tag $IMAGE --project $PROJECT
  if ($LASTEXITCODE -ne 0) { throw "❌ BUILD FAILURE" }

  Write-Host ""
  Write-Host "[DEPLOY] Publicando nova imagem..."
  gcloud run deploy $SERVICE --image $IMAGE --project $PROJECT --region $REGION --quiet
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

  $liveDbName = [string](($liveEnv | Where-Object { $_.name -eq "DB_NAME" } | Select-Object -First 1).value)
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
if (-not $TIMEOUT)             { $TIMEOUT = "300" }
if (-not $PORT)                { $PORT = "8080" }
if (-not $CONCURRENCY)         { $CONCURRENCY = "80" }
if (-not $SCHEDULER_LOCATION)  { $SCHEDULER_LOCATION = $REGION }
if (-not $TIMEZONE)            { $TIMEZONE = "America/Sao_Paulo" }

# Repositório: DEPLOY_IMAGE_REPO (projeto compartilhado) ou, se vazio, o padrão antigo = nome do serviço
if (-not $IMAGE_REPO) { $IMAGE_REPO = $SERVICE }
$IMAGE = "$REGION-docker.pkg.dev/$PROJECT/$IMAGE_REPO/${SERVICE}:" + (Get-Date).ToString("yyyyMMdd-HHmmss")
$ENV_YAML = Join-Path $env:TEMP "erpconsart-env-$SERVICE.yaml"

Write-Host ""
Write-Host "[INFO] PROJECT = $PROJECT"
Write-Host "[INFO] REGION  = $REGION"
Write-Host "[INFO] SERVICE = $SERVICE"
Write-Host "[INFO] IMAGE   = $IMAGE"

gcloud config set project $PROJECT | Out-Null

Write-Host ""
Write-Host "[APIs] Habilitando APIs necessárias..."

gcloud services enable `
  run.googleapis.com `
  cloudbuild.googleapis.com `
  artifactregistry.googleapis.com `
  compute.googleapis.com `
  vpcaccess.googleapis.com `
  storage.googleapis.com `
  cloudscheduler.googleapis.com `
  sqladmin.googleapis.com | Out-Null

if ($CONNECTOR_NAME -and $VPC_NETWORK -and $VPC_RANGE) {
  Write-Host ""
  Write-Host "[VPC ACCESS] Verificando conector..."

  $existing = $(gcloud compute networks vpc-access connectors describe $CONNECTOR_NAME `
    --region $REGION `
    --project $PROJECT `
    --format="value(name)" 2>$null)

  if (-not $existing) {
    gcloud compute networks vpc-access connectors create $CONNECTOR_NAME `
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

  for ($i = 0; $i -lt 60; $i++) {
    $state = $(gcloud compute networks vpc-access connectors describe $CONNECTOR_NAME `
      --region $REGION `
      --project $PROJECT `
      --format="value(state)" 2>$null)

    if ($state -eq "READY") {
      Write-Host "[VPC ACCESS] READY"
      break
    }

    Start-Sleep -Seconds 5
  }
}

if ($ROUTER_NAME -and $NAT_NAME -and $VPC_NETWORK) {
  Write-Host ""
  Write-Host "[NAT] Verificando Router e NAT..."

  $router = $(gcloud compute routers describe $ROUTER_NAME `
    --region $REGION `
    --project $PROJECT `
    --format="value(name)" 2>$null)

  if (-not $router) {
    gcloud compute routers create $ROUTER_NAME `
      --network $VPC_NETWORK `
      --region $REGION `
      --project $PROJECT | Out-Null
  }

  $nat = $(gcloud compute routers nats describe $NAT_NAME `
    --router $ROUTER_NAME `
    --region $REGION `
    --project $PROJECT `
    --format="value(name)" 2>$null)

  if (-not $nat) {
    gcloud compute routers nats create $NAT_NAME `
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

gcloud builds submit --tag $IMAGE --project $PROJECT

if ($LASTEXITCODE -ne 0) {
  throw "❌ BUILD FAILURE"
}

$APPENV["GOOGLE_CLOUD_PROJECT"] = $PROJECT
$APPENV["CLOUD_RUN_REGION"] = $REGION

# ✅ Cloud Run safe boot: impede listeners longos no startup
$APPENV["ENABLE_EMAIL_INBOUND"] = "false"
$APPENV["ENABLE_DFE_SCHEDULER"] = "false"

Write-Host ""
Write-Host "[ENV] Gerando arquivo YAML temporário..."

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
  "--startup-probe", "tcpSocket.port=8080,periodSeconds=10,timeoutSeconds=10,failureThreshold=24",
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

Write-Host ""
Write-Host "✅ Deploy concluído com sucesso."
Write-Host "[INFO] Serviço publicado: $SERVICE"
Write-Host "[INFO] Região: $REGION"

try {
  Remove-Item $ENV_YAML -Force -ErrorAction SilentlyContinue
} catch { }

# =========================================================
# SCHEDULER — LIGA/DESLIGA AUTOMÁTICO (COM TOKEN)
# =========================================================

Write-Host ""
Write-Host "[SCHEDULER] Configurando liga/desliga automático..." -ForegroundColor Yellow

if (-not $BASE_URL) {
  $BASE_URL = $(gcloud run services describe $SERVICE `
    --project=$PROJECT `
    --region=$REGION `
    --format="value(status.url)")
}

# $ENVALL (e não $APPENV): o token pode ter saído do YAML por vir do Secret Manager
$ADMIN_TOKEN = $ENVALL["CONSART_ADMIN_TOKEN"]

if (-not $ADMIN_TOKEN) {
  throw "❌ CONSART_ADMIN_TOKEN não encontrado no .env."
}
