param(
  [switch]$NonInteractive
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Ask-Value {
  param(
    [string]$Prompt,
    [string]$Default = '',
    [switch]$Secret
  )

  if ($NonInteractive -and $Default) { return $Default }

  if ($Secret) {
    $secure = Read-Host "$Prompt" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  }

  if ($Default) {
    $v = Read-Host "$Prompt [$Default]"
    if ([string]::IsNullOrWhiteSpace($v)) { return $Default }
    return $v
  }

  return (Read-Host "$Prompt")
}

function Ensure-Command {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

Write-Host "== Chat-iK installer (Windows) ==" -ForegroundColor Cyan

if (-not (Ensure-Command docker)) {
  Write-Host "Docker не найден. Пытаюсь установить Docker Desktop через winget..." -ForegroundColor Yellow
  if (-not (Ensure-Command winget)) {
    throw "winget не найден. Установите App Installer из Microsoft Store и повторите."
  }
  winget install -e --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
  Write-Host "Docker Desktop установлен. Запустите его и дождитесь статуса Running, затем повторите скрипт." -ForegroundColor Yellow
  exit 1
}

try {
  docker compose version | Out-Null
} catch {
  throw "docker compose недоступен. Обновите Docker Desktop."
}

$domain = Ask-Value -Prompt "Какой домен будет у сервиса (без https://)" -Default "chat.example.com"
$vapidEmail = Ask-Value -Prompt "Email для VAPID" -Default "mailto:admin@$domain"
$pgUser = Ask-Value -Prompt "PostgreSQL пользователь" -Default "chatik"
$pgDb = Ask-Value -Prompt "PostgreSQL база" -Default "chatik"
$pgPass = Ask-Value -Prompt "PostgreSQL пароль" -Default ([Guid]::NewGuid().ToString('N'))
$minioUser = Ask-Value -Prompt "MinIO пользователь" -Default "chatik_minio"
$minioPass = Ask-Value -Prompt "MinIO пароль" -Default ([Guid]::NewGuid().ToString('N'))
$minioBucket = Ask-Value -Prompt "MinIO bucket" -Default "chatik"
$jwtSecret = Ask-Value -Prompt "JWT secret" -Default (([Guid]::NewGuid().ToString('N')) + ([Guid]::NewGuid().ToString('N')))
$turnExternalIp = Ask-Value -Prompt "Внешний IP для TURN (можно пусто)" -Default ""
$turnUser = Ask-Value -Prompt "TURN username" -Default "chatik_turn"
$turnPass = Ask-Value -Prompt "TURN пароль" -Default ([Guid]::NewGuid().ToString('N'))

$adminUser = Ask-Value -Prompt "Логин администратора" -Default "admin"
$adminName = Ask-Value -Prompt "Отображаемое имя администратора" -Default "Administrator"
$adminPass = Ask-Value -Prompt "Пароль администратора" -Secret
if ([string]::IsNullOrWhiteSpace($adminPass)) { throw "Пароль администратора обязателен." }

Write-Host "Генерирую VAPID ключи..." -ForegroundColor Yellow
$vapidShellCmd = 'npm -s i -g web-push >/dev/null 2>&1; web-push generate-vapid-keys --json'
$vapidJsonRaw = docker run --rm node:20-alpine sh -lc $vapidShellCmd | Out-String
$vapidJsonMatch = [regex]::Match($vapidJsonRaw, '\{[\s\S]*\}')
if (-not $vapidJsonMatch.Success) {
  throw "Не удалось получить JSON с VAPID ключами"
}
$vapid = $vapidJsonMatch.Value | ConvertFrom-Json
if (-not $vapid.publicKey -or -not $vapid.privateKey) {
  throw "Не удалось сгенерировать VAPID ключи"
}

$envText = @"
APP_DOMAIN=$domain
POSTGRES_USER=$pgUser
POSTGRES_PASSWORD=$pgPass
POSTGRES_DB=$pgDb
MINIO_ROOT_USER=$minioUser
MINIO_ROOT_PASSWORD=$minioPass
MINIO_BUCKET=$minioBucket
JWT_SECRET=$jwtSecret
VAPID_PUBLIC_KEY=$($vapid.publicKey)
VAPID_PRIVATE_KEY=$($vapid.privateKey)
VAPID_CONTACT_EMAIL=$vapidEmail
TURN_REALM=$domain
TURN_EXTERNAL_IP=$turnExternalIp
TURN_USERNAME=$turnUser
TURN_PASSWORD=$turnPass
"@

Set-Content -Path (Join-Path $root '.env') -Value $envText -NoNewline -Encoding UTF8

Write-Host "Собираю и запускаю контейнеры..." -ForegroundColor Yellow
docker compose build --no-cache backend frontend
docker compose up -d

Start-Sleep -Seconds 8
try {
  Invoke-RestMethod -Uri 'http://localhost:8080/api/auth/register' -Method Post -ContentType 'application/json' -Body (@{
    username = $adminUser
    password = $adminPass
    display_name = $adminName
    public_key = 'bootstrap_pending_key'
  } | ConvertTo-Json -Compress) | Out-Null
} catch {}

$adminUserSql = $adminUser -replace "'", "''"
$sql = "UPDATE users SET is_admin = true WHERE username = lower('$adminUserSql');"
docker compose exec -T postgres psql -U $pgUser -d $pgDb -v ON_ERROR_STOP=1 -c $sql

Write-Host "✅ Установка завершена." -ForegroundColor Green
Write-Host "Откройте: http://localhost:8080"
Write-Host "Админ: $adminUser"
