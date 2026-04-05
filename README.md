# chat-iK Messenger

Современный self-hosted мессенджер с E2EE, звонками, push-уведомлениями, админ-панелью и кроссплатформенной нативной упаковкой.

## Возможности
- Личные и групповые чаты
- Сквозное шифрование сообщений (E2EE)
- Аудио/видео звонки (WebRTC + TURN)
- Голосовые сообщения и вложения (MinIO)
- Push-уведомления (PWA + VAPID)
- Контакты по `ID` и `QR`
- Админ-панель управления пользователями
- Гибкие UI-пресеты и мобильная адаптация
- Нативная упаковка через Tauri (Windows, Linux, Android)

## Технологии
- Frontend: `React + Vite`
- Backend: `Fastify + PostgreSQL`
- Storage: `MinIO`
- Realtime: `WebSocket`
- Calls: `WebRTC + coturn`
- Delivery: `Docker Compose`

## Структура
```text
backend/              API, ws, миграции БД
frontend/             Web/PWA + Tauri shell
scripts/              Автоустановка и сервисные скрипты
docker-compose.yaml   Прод-оркестрация
nginx.conf            Роутинг frontend/api/ws
.env.example          Шаблон переменных окружения
```

## Быстрый старт (рекомендуется)

### Windows
```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\install-windows.ps1
```

### Linux
```bash
chmod +x scripts/install-linux.sh
./scripts/install-linux.sh
```

### Synology DSM
```bash
chmod +x scripts/install-synology.sh
./scripts/install-synology.sh
```

Скрипты задают вопросы и автоматически:
1. Проверяют/доустанавливают зависимости
2. Генерируют VAPID-ключи
3. Формируют `.env`
4. Собирают и поднимают контейнеры
5. Создают аккаунт администратора

## Ручной запуск
1. Создать `.env` из шаблона:
```bash
cp .env.example .env
```
2. Заполнить секреты/домен
3. Поднять стек:
```bash
docker compose build --no-cache backend frontend
docker compose up -d
```
4. Проверить:
- Приложение: `http://localhost:8080`
- API: `http://localhost:8080/api/auth/captcha`

## Переменные окружения
Минимально обязательные:
- `APP_DOMAIN`
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
- `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_BUCKET`
- `JWT_SECRET`
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CONTACT_EMAIL`
- `TURN_REALM`, `TURN_USERNAME`, `TURN_PASSWORD`
- `TURN_EXTERNAL_IP` (опционально)

## Первичная настройка прод-сервера
1. DNS: домен должен указывать на сервер
2. HTTPS: настроить сертификат (Let's Encrypt)
3. Проброс портов:
- `80/443` (reverse proxy)
- `3478/3479` TCP+UDP (TURN)
- `49160-49200` TCP+UDP (media relay)
4. Проверить push-уведомления только по `HTTPS`

### Какие порты открыть/прокинуть на роутере (NAT)
Обязательно:
- `80/TCP` → сервер (HTTP, для первичного редиректа/ACME)
- `443/TCP` → сервер (HTTPS, web + API + websocket + push)
- `3478/TCP` и `3478/UDP` → сервер (TURN/STUN)
- `3479/TCP` и `3479/UDP` → сервер (альтернативный TURN/STUN)
- `49160-49200/TCP` и `49160-49200/UDP` → сервер (медиа-релей звонков)

Рекомендации:
- В firewall разрешить эти порты только для нужных интерфейсов.
- Если используется отдельный reverse proxy — `80/443` прокидывать на него.
- После проброса проверить с внешней сети доступность `443` и `3478/3479`.

## Полная очистка данных (перед переносом/релизом)
Удаляет все пользовательские данные, БД и файлы.

### Windows
```powershell
.\scripts\reset-data.ps1
```

### Linux/Synology
```bash
chmod +x scripts/reset-data.sh
./scripts/reset-data.sh
```

## Назначение администратора
```bash
chmod +x scripts/promote-admin.sh
./scripts/promote-admin.sh
```

## Нативные приложения (Tauri)
В `frontend/`:
```bash
npm install
```

### Windows/Linux
```bash
npm run tauri:build
```

### Android
```bash
npm run tauri:android:init
npm run tauri:android:build
```

Поведение клиента:
- при первом запуске приложение просит адрес сервера
- адрес сохраняется локально
- на экране входа есть кнопка смены сервера

## Безопасность
- Не коммитьте `.env`
- Используйте длинные случайные секреты
- Регулярно обновляйте Docker-образы
- Ограничьте доступ к админ-панели сетью/VPN/2FA reverse proxy
- Делайте резервные копии `postgres_data` и `minio_data`

## Troubleshooting
- Ошибки push: проверьте `VAPID_*` и HTTPS
- Проблемы звонков: проверьте TURN порты и `TURN_EXTERNAL_IP`
- Проблемы входа: проверьте синхронизацию времени на сервере

## CI/CD и релизы (GitHub Actions)

Добавленные workflow:
- `.github/workflows/ci.yml` — базовая проверка сборки frontend/backend
- `.github/workflows/docker-images.yml` — сборка и push Docker-образов в GHCR
- `.github/workflows/tauri-desktop.yml` — desktop Tauri build (Windows + Linux)
- `.github/workflows/release.yml` — публикация GitHub Release при теге `v*`

### Выпуск релиза
```bash
git tag v1.0.0-beta
git push origin v1.0.0-beta
```

После push тега автоматически:
1. создается GitHub Release,
2. запускается сборка Docker-образов,
3. запускается desktop Tauri build.

### GitHub Variables (рекомендуется)
Repository → Settings → Secrets and variables → Actions → Variables:
- `VITE_VAPID_PUBLIC_KEY`
- `VITE_TURN_USERNAME`
- `VITE_TURN_PASSWORD`
