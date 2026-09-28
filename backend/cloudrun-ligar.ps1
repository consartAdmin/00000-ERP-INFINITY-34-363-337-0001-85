# ╔══════════════════════════════════════════════════════════════╗
# ║ cloudrun-ligar.ps1 — Liga/Aquece Cloud Run                  ║
# ║ Lê DEPLOY_* do .env                                         ║
# ╚══════════════════════════════════════════════════════════════╝

$ErrorActionPreference = "Stop"

function Resolve-DotEnvPath {
  $candidates = @(".env", "backend/.env", "../backend/.env")
  foreach ($p in $candidates) {
    if (Test-Path $p) { return (Resolve-Path $p).Path }
  }
  return $null
}

function Normalize-EnvValue([string]$value) {
  if ($null -eq $value) { return $null }
  $v = $value.Trim()

  if (($v.StartsWith('"') -and $v.EndsWith('"')) -or
      ($v.StartsWith("'") -and $v.EndsWith("'"))) {
    $v = $v.Substring(1, $v.Length - 2).Trim()
  }

  return $v
}

function Load-DotEnv($path) {
  $map = @{}
  Get-Content $path | ForEach-Object {
    $line = $_.Trim()

    if ([string]::IsNullOrWhiteSpace($line)) { return }
    if ($line.StartsWith("#")) { return }

    $eq = $line.IndexOf("=")
    if ($eq -lt 1) { return }

    $k = $line.Substring(0, $eq).Trim()
    $v = $line.Substring($eq + 1).Trim()
    $map[$k] = Normalize-EnvValue $v
  }
  return $map
}

$DotEnvPath = Resolve-DotEnvPath
if (-not $DotEnvPath) {
  throw "❌ Arquivo .env não encontrado."
}

Write-Host "[INFO] Usando .env em: $DotEnvPath"

$ENVALL = Load-DotEnv $DotEnvPath

$PROJECT = $ENVALL["DEPLOY_PROJECT"]
$REGION  = $ENVALL["DEPLOY_REGION"]
$SERVICE = $ENVALL["DEPLOY_SERVICE"]

Write-Host "[INFO] PROJECT = '$PROJECT'"
Write-Host "[INFO] REGION  = '$REGION'"
Write-Host "[INFO] SERVICE = '$SERVICE'"

if ([string]::IsNullOrWhiteSpace($PROJECT) -or
    [string]::IsNullOrWhiteSpace($REGION) -or
    [string]::IsNullOrWhiteSpace($SERVICE)) {
  throw "❌ Informe DEPLOY_PROJECT, DEPLOY_REGION e DEPLOY_SERVICE no .env."
}

& gcloud --version
if ($LASTEXITCODE -ne 0) {
  throw "❌ gcloud não encontrado."
}

& gcloud config set project $PROJECT
if ($LASTEXITCODE -ne 0) {
  throw "❌ Falha ao definir projeto."
}

Write-Host "[INFO] Verificando se o serviço existe..."
& gcloud run services describe $SERVICE --region $REGION
if ($LASTEXITCODE -ne 0) {
  throw "❌ Serviço não encontrado nesse projeto/região."
}

Write-Host "[INFO] Atualizando Cloud Run..."
& gcloud run services update $SERVICE `
  --region $REGION `
  --min-instances 1

if ($LASTEXITCODE -ne 0) {
  throw "❌ Falha no update."
}

Write-Host "✅ Atualizado com sucesso."