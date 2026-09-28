# ╔══════════════════════════════════════════════════════════════╗
# ║ setup-sleep-wake.ps1 — CONSART Ops + Scheduler (22:00/05:00) ║
# ║ Timezone: America/Sao_Paulo                                  ║
# ╚══════════════════════════════════════════════════════════════╝

$ErrorActionPreference = "Continue"
$global:ProgressPreference = 'SilentlyContinue'

# ───────────────────────────────────────────────────────────────
# ✅ EDIT HERE
# ───────────────────────────────────────────────────────────────
$PROJECT        = "valued-torch-463412-r7"
$REGION         = "us-central1"
$OPS_SERVICE    = "consart-ops"
$ERP_SERVICE    = "erpconsart"
$SQL_INSTANCE   = "consart-postgres"

# Day scaling (wake)
$DAY_MIN        = 1
$DAY_MAX        = 3

# Night scaling (sleep)
$NIGHT_MIN      = 0
$NIGHT_MAX      = 1   # max cannot be 0

# Shared secret (make it strong)
$OPS_KEY = "/2Q1TzWKjjNj985Ik6QDB2nQ2N1SNw3njgjrmJyGGw+wrkjumBAzDgv8Shy2n6Ln"

# Scheduler settings
$TZ             = "America/Sao_Paulo"
$CRON_SLEEP     = "0 22 * * *"  # 22:00
$CRON_WAKE      = "0 5 * * *"   # 05:00
# ───────────────────────────────────────────────────────────────

function Run-GCloud {
  param(
    [Parameter(Mandatory=$true)][string[]]$Args,
    [switch]$IgnoreErrors
  )

  $out = & gcloud @Args 2>&1
  $code = $LASTEXITCODE

  if ($out) { $out | ForEach-Object { Write-Host $_ } }

  if (-not $IgnoreErrors -and $code -ne 0) {
    throw "gcloud failed (exit=$code): gcloud $($Args -join ' ')"
  }

  return $out
}

Write-Host "`n[CFG] PROJECT=$PROJECT REGION=$REGION ERP=$ERP_SERVICE SQL=$SQL_INSTANCE"

if (-not $PROJECT -or -not $REGION -or -not $ERP_SERVICE -or -not $SQL_INSTANCE) {
  throw "Missing required config. Check PROJECT/REGION/ERP_SERVICE/SQL_INSTANCE."
}

# ── Set project + enable APIs
Run-GCloud @("config","set","project",$PROJECT) | Out-Null
Run-GCloud @("services","enable","run.googleapis.com","cloudscheduler.googleapis.com","sqladmin.googleapis.com","iam.googleapis.com") | Out-Null

# ── Service Accounts
$OPS_SA   = "consart-ops-sa"
$SCHED_SA = "consart-scheduler-sa"

function Ensure-SA {
  param([Parameter(Mandatory=$true)][string]$name)

  $email = "$name@$PROJECT.iam.gserviceaccount.com"

  # If already exists, ok
  $already = Run-GCloud @("iam","service-accounts","describe",$email,"--format=value(email)") -IgnoreErrors
  if (-not $already -or (($already -join "").Trim() -ne $email)) {
    # create
    Run-GCloud @("iam","service-accounts","create",$name,"--display-name=$name") -IgnoreErrors | Out-Null
  }

  # Verify
  $exists = Run-GCloud @("iam","service-accounts","describe",$email,"--format=value(email)") -IgnoreErrors
  if (-not $exists -or (($exists -join "").Trim() -ne $email)) {
    $list = Run-GCloud @("iam","service-accounts","list","--format=value(email)") -IgnoreErrors
    if (-not (($list -join "`n").Contains($email))) {
      throw "Could not verify or create service account: $email"
    }
  }

  Write-Host "[IAM] SA OK: $email"
  return $email
}

$OPS_SA_EMAIL   = Ensure-SA $OPS_SA
$SCHED_SA_EMAIL = Ensure-SA $SCHED_SA

# ── Grant permissions to OPS SA (patch Cloud Run + Cloud SQL)
Write-Host "`n[IAM] Granting roles to OPS SA..."
Run-GCloud @("projects","add-iam-policy-binding",$PROJECT,"--member=serviceAccount:$OPS_SA_EMAIL","--role=roles/run.admin") | Out-Null
Run-GCloud @("projects","add-iam-policy-binding",$PROJECT,"--member=serviceAccount:$OPS_SA_EMAIL","--role=roles/cloudsql.admin") | Out-Null

# ── Deploy OPS service (private)
Write-Host "`n[RUN] Deploying OPS service ($OPS_SERVICE) ..."
$envVars = "PROJECT_ID=$PROJECT,REGION=$REGION,TARGET_SERVICE=$ERP_SERVICE,SQL_INSTANCE=$SQL_INSTANCE,DAY_MIN_INSTANCES=$DAY_MIN,DAY_MAX_INSTANCES=$DAY_MAX,NIGHT_MIN_INSTANCES=$NIGHT_MIN,NIGHT_MAX_INSTANCES=$NIGHT_MAX,OPS_KEY=$OPS_KEY"

Run-GCloud @(
  "run","deploy",$OPS_SERVICE,
  "--source","./ops",
  "--region",$REGION,
  "--service-account",$OPS_SA_EMAIL,
  "--no-allow-unauthenticated",
  "--set-env-vars",$envVars
) | Out-Null

# ── Get OPS URL
$OPS_URL_OUT = Run-GCloud @("run","services","describe",$OPS_SERVICE,"--region",$REGION,"--format=value(status.url)") -IgnoreErrors
$OPS_URL = ($OPS_URL_OUT -join "").Trim()
if (-not $OPS_URL) { throw "Could not get OPS URL" }
Write-Host "[RUN] OPS URL: $OPS_URL"

# ── Allow Scheduler SA to invoke OPS
Write-Host "`n[RUN] Grant invoker to Scheduler SA..."
Run-GCloud @(
  "run","services","add-iam-policy-binding",$OPS_SERVICE,
  "--region",$REGION,
  "--member=serviceAccount:$SCHED_SA_EMAIL",
  "--role=roles/run.invoker"
) | Out-Null

# ───────────────────────────────────────────────────────────────
# Scheduler jobs (create or update)
# ───────────────────────────────────────────────────────────────
function Ensure-JobHttp {
  param(
    [Parameter(Mandatory=$true)][string]$jobName,
    [Parameter(Mandatory=$true)][string]$cron,
    [Parameter(Mandatory=$true)][string]$uri
  )

  # Does job exist?
  $descOut = Run-GCloud @("scheduler","jobs","describe",$jobName,"--location",$REGION,"--format=value(name)") -IgnoreErrors
  $exists = ($descOut -and (($descOut -join "").Trim().Length -gt 0) -and ($LASTEXITCODE -eq 0))

  if (-not $exists) {
    Write-Host "[SCHED] Creating job: $jobName -> $uri @ $cron ($TZ)"
    Run-GCloud @(
      "scheduler","jobs","create","http",$jobName,
      "--location",$REGION,
      "--schedule",$cron,
      "--time-zone",$TZ,
      "--uri",$uri,
      "--http-method","POST",
      "--oidc-service-account-email",$SCHED_SA_EMAIL,
      "--headers","x-ops-key=$OPS_KEY"
    ) | Out-Null
    return
  }

  Write-Host "[SCHED] Updating job: $jobName"

  # Update core fields (supported)
  Run-GCloud @(
    "scheduler","jobs","update","http",$jobName,
    "--location",$REGION,
    "--schedule",$cron,
    "--time-zone",$TZ,
    "--uri",$uri,
    "--http-method","POST",
    "--oidc-service-account-email",$SCHED_SA_EMAIL
  ) | Out-Null

  # Update headers if supported; otherwise recreate
  $ok = $true
  try {
    Run-GCloud @(
      "scheduler","jobs","update","http",$jobName,
      "--location",$REGION,
      "--update-headers","x-ops-key=$OPS_KEY"
    ) | Out-Null
  } catch {
    $ok = $false
  }

  if (-not $ok) {
    Write-Host "[SCHED] update-headers not supported. Recreating job to apply headers..."
    Run-GCloud @("scheduler","jobs","delete",$jobName,"--location",$REGION,"--quiet") -IgnoreErrors | Out-Null
    Run-GCloud @(
      "scheduler","jobs","create","http",$jobName,
      "--location",$REGION,
      "--schedule",$cron,
      "--time-zone",$TZ,
      "--uri",$uri,
      "--http-method","POST",
      "--oidc-service-account-email",$SCHED_SA_EMAIL,
      "--headers","x-ops-key=$OPS_KEY"
    ) | Out-Null
  }
}

Ensure-JobHttp "consart-sleep-2200" $CRON_SLEEP "$OPS_URL/sleep"
Ensure-JobHttp "consart-wake-0500"  $CRON_WAKE  "$OPS_URL/wake"

Write-Host "`n✅ DONE!"
Write-Host " - Sleep job: 22:00 -> POST $OPS_URL/sleep (SQL NEVER + Run min=$NIGHT_MIN)"
Write-Host " - Wake  job: 05:00 -> POST $OPS_URL/wake  (SQL ALWAYS + Run min=$DAY_MIN)"
Write-Host ""
Write-Host "TIP: Test manually:"
Write-Host "  curl -X POST `"$OPS_URL/sleep`" -H `"x-ops-key: $OPS_KEY`""
Write-Host "  curl -X POST `"$OPS_URL/wake`"  -H `"x-ops-key: $OPS_KEY`""