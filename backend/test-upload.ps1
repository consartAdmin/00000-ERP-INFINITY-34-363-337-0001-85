# ╔══════════════════════════════════════════════════════╗
# ║ Teste de Upload de Anexo (PS 5.1 / PS 7+)            ║
# ║ Endpoint: /api/upload/anexo                          ║
# ║ Campos: arquivo(file), movId, basePrefix             ║
# ╚══════════════════════════════════════════════════════╝

param(
  [string]$Endpoint   = "http://localhost:8080/api/upload/anexo", # ou /api/caixa/upload/anexo
  [string]$FilePath   = "",                                       # ex: C:\Temp\nota.pdf
  [int]   $MovId      = 1959,                                     # ID existente na tabela de movimentações
  [string]$BasePrefix = "doc.contabil"
)

# TLS mais moderno no PS 5.1
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

# Se não informar -FilePath, tenta pegar do Desktop (mesmo nome usado por você)
if (-not $FilePath -or $FilePath.Trim() -eq "") {
  $FilePath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'NOTA FISCAL EFFORT.pdf'
}

# Resolve caminho absoluto e verifica existência
try {
  $FilePath = (Get-Item -LiteralPath $FilePath -ErrorAction Stop).FullName
} catch {
  throw "Arquivo não encontrado: $FilePath"
}

if (-not $MovId -or $MovId -le 0) { throw "movId inválido. Informe um ID numérico existente." }

Write-Host "→ Endpoint : $Endpoint"
Write-Host "→ Arquivo  : $FilePath"
Write-Host "→ movId    : $MovId"
Write-Host "→ PS Ver   : $($PSVersionTable.PSVersion.ToString())"
Write-Host ""

Add-Type -AssemblyName System.Net.Http

$client    = [System.Net.Http.HttpClient]::new()
$multipart = [System.Net.Http.MultipartFormDataContent]::new()

# ===== Arquivo =====
$fileStream  = [System.IO.File]::OpenRead($FilePath)
$fileName    = [System.IO.Path]::GetFileName($FilePath)
$fileContent = [System.Net.Http.StreamContent]::new($fileStream)

# Inferir MIME por extensão
$mime = "application/octet-stream"
switch -Regex ($fileName) {
  '\.pdf$'   { $mime = "application/pdf"; break }
  '\.png$'   { $mime = "image/png"; break }
  '\.jpe?g$' { $mime = "image/jpeg"; break }
}
$fileContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse($mime)

# Campo arquivo chama-se "arquivo" no backend
$null = $multipart.Add($fileContent, "arquivo", $fileName)

# ===== Campos texto =====
$null = $multipart.Add([System.Net.Http.StringContent]::new($MovId.ToString()),  "movId")
$null = $multipart.Add([System.Net.Http.StringContent]::new($BasePrefix),        "basePrefix")

try {
  Write-Host "⏫ Enviando..."
  $resp  = $client.PostAsync($Endpoint, $multipart).GetAwaiter().GetResult()
  $code  = [int]$resp.StatusCode
  $body  = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult()

  Write-Host "`nHTTP $code`n"
  if ($body) {
    try { ($body | ConvertFrom-Json) | Format-List | Out-String | Write-Host }
    catch { Write-Host $body }
  } else {
    Write-Host "(sem corpo)"
  }

  if ($code -ge 200 -and $code -lt 300) {
    Write-Host "`n✅ Upload OK."
  } else {
    Write-Warning "❌ Falha no upload. Verifique logs do backend."
  }
}
finally {
  $fileStream.Dispose(); $client.Dispose(); $multipart.Dispose()
}
