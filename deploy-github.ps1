param([string]$msg = "Update $(Get-Date -Format 'yyyy-MM-dd HH:mm')")
Set-Location $PSScriptRoot
if (-not (Test-Path .git)) { git init }

$ignore = "backend/.env","backend/keys/","backend/public/boletos/","node_modules/"
if (-not (Test-Path .gitignore)) { New-Item .gitignore | Out-Null }
foreach ($i in $ignore) { if (-not (Select-String -Path .gitignore -SimpleMatch $i -Quiet)) { Add-Content .gitignore $i } }
git rm -r --cached --ignore-unmatch -q backend/.env backend/keys backend/public/boletos node_modules

if (-not (git remote)) {
  $url = Read-Host "Paste the GitHub repository URL (https://github.com/USER/REPO.git)"
  git remote add origin $url
}

git add .
git commit -m $msg
git push -u origin (git branch --show-current)