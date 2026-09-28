# ╔══════════════════════════════════════════════════════════════╗
# ║ cloudrun-desligar.ps1 — Desliga Cloud Run (CORRETO)         ║
# ╚══════════════════════════════════════════════════════════════╝

$PROJECT = "valued-torch-463412-r7"
$REGION  = "us-central1"
$SERVICE = "erpconsart"

gcloud config set project $PROJECT | Out-Null

Write-Host " Desligando Cloud Run: $SERVICE ..."

gcloud run services update $SERVICE `
  --region $REGION `
  --min-instances=0

Write-Host " Cloud Run em modo econômico (0 instâncias mínimas)"