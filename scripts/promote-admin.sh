#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

read -r -p "Введите username пользователя для назначения админом: " username
if [ -z "$username" ]; then
  echo "Username обязателен" >&2
  exit 1
fi

if [ ! -f .env ]; then
  echo "Не найден .env" >&2
  exit 1
fi

# shellcheck disable=SC1091
source .env

docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
  -c "UPDATE users SET is_admin=true WHERE username=lower('$username');"

echo "Готово."
