# =========================
# deploy-lite.ps1 – Build + Deploy rápido no Cloud Run (PowerShell)
# =========================
# Uso opcional:
#   .\deploy-lite.ps1              # build + deploy usando Secret existente
#   .\deploy-lite.ps1 -PASS_FILE .\pass.txt   # cria nova versão do Secret a partir do arquivo (sem CRLF)

param(
  [string]$PASS_FILE = ""   # caminho para um arquivo contendo apenas a senha do PFX (sem newline)
)

$ErrorActionPreference = "Stop"

# -------- Config --------
$PROJECT   = "valued-torch-463412-r7"
$REGION    = "us-central1"
$SERVICE   = "erpconsart"
$IMAGE     = "gcr.io/$PROJECT/$SERVICE"

# Certificado A1 (GCS + Secret)
$NFE_BUCKET = "consart-erp"
$NFE_OBJECT = "certificadoDigital/1758478226747-CERT.DIG.BH3_2025.pfx"
$SECRET_A1  = "NFE_CERT_PFX_PASS"   # nome do Secret no Secret Manager

# NF-e / Ambiente
$NFE_ENABLED          = "1"                 # liga faturamento/transmissão
$NFE_ENV              = "1"                 # 1=produção, 2=homolog
$NFE_UF               = "MG"
$NFE_UF_COD           = "31"
$NFE_DEBUG            = "1"
$NFE_DEBUG_DIR        = "/tmp/nfe/debug"
$NFE_VALIDATE_STRICT  = "0"                 # 0 = validação permissiva para dev

# Envs legadas para limpar (NÃO remove NFE_ENABLED)
$REMOVE_ENVS = @(
  "A1_SENHA",
  "NFE_ENABLE",
  "NFE_WS_STATUS_URL",
  "NFE_WS_AUTORIZACAO_URL",
  "NFE_WS_RET_AUTORIZACAO_URL"
) -join ","

# -------- Projeto --------
Write-Host "`n[ CONFIG ] Projeto/Região"
gcloud config set project $PROJECT | Out-Null

# -------- Secret opcional (atualizar versão) --------
if ($PASS_FILE -and (Test-Path $PASS_FILE)) {
  Write-Host "`n[ SECRET ] Atualizando '$SECRET_A1' com arquivo: $PASS_FILE"

  # Garante que NÃO há CRLF no final do arquivo
  $raw = Get-Content -Raw -Encoding UTF8 $PASS_FILE
  if ($raw.EndsWith("`r`n"))     { $raw = $raw.TrimEnd("`r","`n") }
  elseif ($raw.EndsWith("`n"))   { $raw = $raw.TrimEnd("`n") }
  elseif ($raw.EndsWith("`r"))   { $raw = $raw.TrimEnd("`r") }
  $tmpNoCrlf = Join-Path $env:TEMP "pass_nocrlf.txt"
  Set-Content -Path $tmpNoCrlf -Value $raw -NoNewline -Encoding UTF8

  # Cria o Secret se não existir
  $exists = $false
  try {
    gcloud secrets describe $SECRET_A1 | Out-Null
    $exists = $true
  } catch { $exists = $false }

  if (-not $exists) {
    gcloud secrets create $SECRET_A1 --replication-policy="automatic" | Out-Null
  }
  gcloud secrets versions add $SECRET_A1 --data-file $tmpNoCrlf | Out-Null
  Remove-Item $tmpNoCrlf -Force -ErrorAction SilentlyContinue
} else {
  Write-Host "`n[ SECRET ] Usando versão existente de '$SECRET_A1' (':latest')."
}

# -------- Build --------
Write-Host "`n[ BUILD ] Enviando build para Cloud Build..."
gcloud builds submit --tag $IMAGE
Write-Host "[ BUILD ] OK"

# -------- Deploy --------
Write-Host "`n[ DEPLOY ] Publicando serviço no Cloud Run..."
gcloud run deploy $SERVICE `
  --image $IMAGE `
  --region $REGION `
  --allow-unauthenticated `
  --port 8080 `
  --memory 4Gi `
  --cpu 2 `
  --concurrency 16 `
  --timeout 600 `
  --min-instances 1 `
  --max-instances 10 `
  --set-secrets "NFE_CERT_PFX_PASS=NFE_CERT_PFX_PASS:1" `
  --update-env-vars NFE_ENABLED=$NFE_ENABLED `
  --update-env-vars NFE_CERT_BUCKET=$NFE_BUCKET,NFE_CERT_OBJECT=$NFE_OBJECT `
  --update-env-vars NFE_TP_AMB=$NFE_ENV,NFE_UF=$NFE_UF,NFE_UF_CODIGO=$NFE_UF_COD `
  --update-env-vars NFE_DEBUG=$NFE_DEBUG,NFE_DEBUG_DIR=$NFE_DEBUG_DIR `
  --update-env-vars NFE_VALIDATE_STRICT=$NFE_VALIDATE_STRICT `
  --remove-env-vars $REMOVE_ENVS
Write-Host "[ DEPLOY ] OK"

# -------- Smoke tests --------
$URL = (gcloud run services describe $SERVICE --region $REGION --format='value(status.url)')
Write-Host "`nService URL: $URL`n"
Write-Host ("Health:                {0}/api/nfe/health" -f $URL)
Write-Host ("Cert (senha presente): {0}/api/nfe/cert/check" -f $URL)
Write-Host ("IP público:            {0}/api/debug/ip" -f $URL)
Write-Host ("Netcheck:              {0}/api/nfe/debug/netcheck" -f $URL)
Write-Host ("mTLS handshake:        {0}/api/nfe/debug/mtls-handshake" -f $URL)
Write-Host ("SEFAZ status (MG):     {0}/api/nfe/debug/status-mg" -f $URL)
Write-Host ("Cert A1 (detalhes):    {0}/api/nfe/debug/a1-info" -f $URL)
Write-Host ""
Write-Host ("Transmitir exemplo:" )
Write-Host ("curl -X POST `"{0}/api/nfe/transmitir/91/`" -H `"Content-Type: application/json`" -d `'{{`"modelo`":`"55`",`"serie`":1}}`'" -f $URL)
Write-Host ""
