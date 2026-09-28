# ╔══════════════════════════════════════════════════════════════════════╗
# ║ cloudsql-ligar.ps1 — Liga Cloud SQL (activation-policy=ALWAYS)       ║
# ║ Projeto: valued-torch-463412-r7                                      ║
# ║ Instância: consart-postgres                                          ║
# ╚══════════════════════════════════════════════════════════════════════╝

$ErrorActionPreference = "Stop"

$PROJECT  = "valued-torch-463412-r7"
$INSTANCE = "erp-infinity-00000"

Write-Host "🟢 Ligando Cloud SQL: $INSTANCE (Projeto: $PROJECT) ..."

# valida gcloud
try { gcloud --version | Out-Null } catch { throw "❌ gcloud não encontrado. Instale o Google Cloud SDK e reinicie o terminal." }

# define projeto
gcloud config set project $PROJECT | Out-Null

# liga (sobe a instância)
gcloud sql instances patch $INSTANCE --activation-policy=ALWAYS

Write-Host "✅ Cloud SQL acionado. (activation-policy=ALWAYS)"
Write-Host "⏳ Aguarde alguns minutos até ficar READY no console."
