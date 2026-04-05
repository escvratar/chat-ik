#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

require_cmd() {
  command -v "$1" >/dev/null 2>&1
}

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

install_pkg_linux() {
  local pkg="$1"
  if require_cmd apt-get; then
    sudo apt-get update -y >/dev/null
    sudo apt-get install -y "$pkg"
  elif require_cmd yum; then
    sudo yum install -y "$pkg"
  elif require_cmd dnf; then
    sudo dnf install -y "$pkg"
  elif require_cmd apk; then
    sudo apk add --no-cache "$pkg"
  else
    echo "[!] Не удалось автоматически установить пакет '$pkg'. Установите вручную." >&2
    exit 1
  fi
}

echo "== Chat-iK installer (Linux) =="

if ! require_cmd curl; then
  echo "[i] Устанавливаю curl..."
  install_pkg_linux curl
fi

if ! require_cmd openssl; then
  echo "[i] Устанавливаю openssl..."
  install_pkg_linux openssl
fi

if ! require_cmd docker; then
  echo "[i] Docker не найден. Устанавливаю Docker..."
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "[i] Docker Compose plugin не найден. Устанавливаю..."
  if require_cmd apt-get; then
    sudo apt-get update -y >/dev/null
    sudo apt-get install -y docker-compose-plugin
  elif require_cmd yum; then
    sudo yum install -y docker-compose-plugin
  elif require_cmd dnf; then
    sudo dnf install -y docker-compose-plugin
  elif require_cmd apk; then
    sudo apk add --no-cache docker-cli-compose
  fi
fi

if ! sudo docker info >/dev/null 2>&1; then
  echo "[i] Запускаю сервис Docker..."
  sudo systemctl enable docker --now >/dev/null 2>&1 || true
fi

echo "\n== Первичная настройка =="
DOMAIN="$(ask "Какой домен будет у сервиса (без https://)" "chat.example.com")"
VAPID_EMAIL="$(ask "Email для VAPID (формат mailto:admin@$DOMAIN)" "mailto:admin@$DOMAIN")"
POSTGRES_USER="$(ask "PostgreSQL пользователь" "chatik")"
POSTGRES_DB="$(ask "PostgreSQL база" "chatik")"
POSTGRES_PASSWORD="$(ask "PostgreSQL пароль" "$(openssl rand -hex 16)")"
MINIO_USER="$(ask "MinIO пользователь" "chatik_minio")"
MINIO_PASSWORD="$(ask "MinIO пароль" "$(openssl rand -hex 16)")"
MINIO_BUCKET="$(ask "MinIO bucket" "chatik")"
JWT_SECRET="$(ask "JWT secret" "$(openssl rand -hex 32)")"
TURN_EXTERNAL_IP="$(ask "Внешний IP для TURN (можно оставить пустым)" "")"
TURN_USERNAME="$(ask "TURN username" "chatik_turn")"
TURN_PASSWORD="$(ask "TURN пароль" "$(openssl rand -hex 16)")"

ADMIN_USERNAME="$(ask "Логин администратора" "admin")"
ADMIN_DISPLAY_NAME="$(ask "Отображаемое имя администратора" "Administrator")"
ADMIN_PASSWORD="$(ask "Пароль администратора" "")"
if [ -z "$ADMIN_PASSWORD" ]; then
  echo "[!] Пароль администратора обязателен" >&2
  exit 1
fi

echo "\n[i] Генерирую VAPID ключи..."
VAPID_JSON="$(docker run --rm node:20-alpine sh -lc "npm -s i -g web-push >/dev/null 2>&1 && web-push generate-vapid-keys --json")"
VAPID_PUBLIC_KEY="$(printf '%s' "$VAPID_JSON" | sed -n 's/.*"publicKey"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
VAPID_PRIVATE_KEY="$(printf '%s' "$VAPID_JSON" | sed -n 's/.*"privateKey"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
if [ -z "$VAPID_PUBLIC_KEY" ] || [ -z "$VAPID_PRIVATE_KEY" ]; then
  echo "[!] Не удалось сгенерировать VAPID ключи" >&2
  exit 1
fi

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

echo "[i] Запускаю сборку и сервисы..."
docker compose build --no-cache backend frontend
docker compose up -d

echo "[i] Жду готовность API..."
for i in {1..60}; do
  if curl -fsS http://localhost:8080/api/auth/captcha >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

curl -fsS -X POST http://localhost:8080/api/auth/register \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$ADMIN_USERNAME\",\"password\":\"$ADMIN_PASSWORD\",\"display_name\":\"$ADMIN_DISPLAY_NAME\",\"public_key\":\"bootstrap_pending_key\"}" >/dev/null 2>&1 || true

docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
  -c "UPDATE users SET is_admin = true WHERE username = lower('$ADMIN_USERNAME');"

echo "\n✅ Установка завершена."
echo "URL: http://localhost:8080 (или ваш домен: https://$DOMAIN)"
echo "Админ: $ADMIN_USERNAME"
echo "\nВажно: если Docker только что установился, может потребоваться новый вход в сессию пользователя для группы docker."
