#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "⚠️  Это удалит ВСЕ данные: пользователей, сообщения, файлы, ключи и подписки."
read -r -p "Продолжить? (yes/no): " ans
if [ "$ans" != "yes" ]; then
  echo "Отменено."
  exit 0
fi

docker compose down -v --remove-orphans

echo "✅ База данных и хранилище очищены (volumes удалены)."
