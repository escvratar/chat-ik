#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ask() {
  local prompt="$1"
  local default="${2:-}"
  local value
  if [ -n "$default" ]; then
    read -r -p "$prompt [$default]: " value
    echo "${value:-$default}"
  else
    read -r -p "$prompt: " value
    echo "$value"
  fi
}

echo "== Chat-iK installer (Synology DSM) =="

if ! command -v docker >/dev/null 2>&1; then
  echo "[i] Docker/Container Manager не найден. Пытаюсь установить..."
  if command -v synopkg >/dev/null 2>&1; then
    synopkg install ContainerManager >/dev/null 2>&1 || synopkg install Docker >/dev/null 2>&1 || true
  fi
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[!] Docker все еще не найден. Установите пакет Container Manager в DSM и повторите." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "[!] В вашей системе нет docker compose plugin. Обновите Container Manager/DSM." >&2
  exit 1
fi

DOMAIN="$(ask "Какой домен будет у сервиса (без https://)" "chat.example.com")"
VAPID_EMAIL="$(ask "Email для VAPID" "mailto:admin@$DOMAIN")"
POSTGRES_USER="$(ask "PostgreSQL пользователь" "chatik")"
POSTGRES_DB="$(ask "PostgreSQL база" "chatik")"
POSTGRES_PASSWORD="$(ask "PostgreSQL пароль" "$(date +%s | sha256sum | head -c 24)")"
MINIO_USER="$(ask "MinIO пользователь" "chatik_minio")"
MINIO_PASSWORD="$(ask "MinIO пароль" "$(date +%s | md5sum | head -c 24)")"
MINIO_BUCKET="$(ask "MinIO bucket" "chatik")"
JWT_SECRET="$(ask "JWT secret" "$(date +%s | sha256sum | head -c 48)")"
TURN_EXTERNAL_IP="$(ask "Внешний IP для TURN (можно оставить пустым)" "")"
TURN_USERNAME="$(ask "TURN username" "chatik_turn")"
TURN_PASSWORD="$(ask "TURN пароль" "$(date +%s | md5sum | head -c 24)")"

ADMIN_USERNAME="$(ask "Логин администратора" "admin")"
ADMIN_DISPLAY_NAME="$(ask "Отображаемое имя администратора" "Administrator")"
ADMIN_PASSWORD="$(ask "Пароль администратора" "")"
if [ -z "$ADMIN_PASSWORD" ]; then
  echo "[!] Пароль администратора обязателен" >&2
  exit 1
fi

echo "[i] Генерирую VAPID ключи..."
VAPID_JSON="$(docker run --rm node:20-alpine sh -lc "npm -s i -g web-push >/dev/null 2>&1 && web-push generate-vapid-keys --json")"
VAPID_PUBLIC_KEY="$(printf '%s' "$VAPID_JSON" | sed -n 's/.*"publicKey"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
VAPID_PRIVATE_KEY="$(printf '%s' "$VAPID_JSON" | sed -n 's/.*"privateKey"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"

cat > .env <<EOF
APP_DOMAIN=$DOMAIN
POSTGRES_USER=$POSTGRES_USER
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=$POSTGRES_DB
MINIO_ROOT_USER=$MINIO_USER
MINIO_ROOT_PASSWORD=$MINIO_PASSWORD
MINIO_BUCKET=$MINIO_BUCKET
JWT_SECRET=$JWT_SECRET
VAPID_PUBLIC_KEY=$VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY=$VAPID_PRIVATE_KEY
VAPID_CONTACT_EMAIL=$VAPID_EMAIL
TURN_REALM=$DOMAIN
TURN_EXTERNAL_IP=$TURN_EXTERNAL_IP
TURN_USERNAME=$TURN_USERNAME
TURN_PASSWORD=$TURN_PASSWORD
EOF

echo "[i] Запускаю сервисы..."
docker compose build --no-cache backend frontend
docker compose up -d

sleep 8
curl -fsS -X POST http://localhost:8080/api/auth/register \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$ADMIN_USERNAME\",\"password\":\"$ADMIN_PASSWORD\",\"display_name\":\"$ADMIN_DISPLAY_NAME\",\"public_key\":\"bootstrap_pending_key\"}" >/dev/null 2>&1 || true

docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
  -c "UPDATE users SET is_admin = true WHERE username = lower('$ADMIN_USERNAME');"

echo "✅ Готово. Проверьте reverse proxy/сертификат в DSM для домена $DOMAIN"
