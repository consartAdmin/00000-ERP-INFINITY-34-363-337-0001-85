# ╔══════════════════════════════════════════════════════════════════════╗
# ║ cloudsql-desligar.ps1 — Desliga Cloud SQL (activation-policy=NEVER)  ║
# ║ Projeto: valued-torch-463412-r7                                      ║
# ║ Instância: consart-postgres                                          ║
# ╚══════════════════════════════════════════════════════════════════════╝

$ErrorActionPreference = "Stop"

$PROJECT  = "valued-torch-463412-r7"
$INSTANCE = "consart-postgres"

Write-Host ""
Write-Host "Desligando Cloud SQL: $INSTANCE (Projeto: $PROJECT)..."

try {
    gcloud --version | Out-Null
} catch {
    throw "gcloud não encontrado. Instale o Google Cloud SDK e reinicie o terminal."
}

gcloud config set project $PROJECT | Out-Null

# Consulta estado atual
$describe = gcloud sql instances describe $INSTANCE `
  --project $PROJECT `
  --format="value(state,settings.activationPolicy)"

if ($LASTEXITCODE -ne 0) {
    throw "Não foi possível consultar o estado da instância $INSTANCE."
}

Write-Host "Estado atual: $describe"

# Se já estiver com NEVER, não tenta patch de novo
if ($describe -match "NEVER") {
    Write-Host "A instância já está com activation-policy=NEVER."
    Write-Host "Nada a fazer."
    exit 0
}

# Tenta desligar
gcloud sql instances patch $INSTANCE --activation-policy=NEVER --quiet

if ($LASTEXITCODE -eq 0) {
    Write-Host "Cloud SQL desligado com sucesso. (activation-policy=NEVER)"
    Write-Host "Para ligar novamente, rode: .\cloudsql-ligar.ps1"
} else {
    Write-Host "Falha ao desligar o Cloud SQL."
    Write-Host "Confira o estado com:"
    Write-Host "gcloud sql instances describe $INSTANCE --project $PROJECT"
    exit 1
}