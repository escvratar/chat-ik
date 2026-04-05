$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "ВНИМАНИЕ: будет удалена вся база данных, файлы и личные данные." -ForegroundColor Yellow
$ans = Read-Host "Продолжить? (yes/no)"
if ($ans -ne 'yes') {
  Write-Host "Отменено."
  exit 0
}

docker compose down -v --remove-orphans
Write-Host "Готово: volumes удалены, данные очищены." -ForegroundColor Green
