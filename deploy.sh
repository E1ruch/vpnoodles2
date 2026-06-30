#!/usr/bin/env bash
#
# Деплой + создание таблицы notification_logs на проде (VPS).
# Безопасно: НЕ использует synchronize(true), не удаляет данные.
#
# Запуск с корня проекта:
#   bash deploy.sh
#
# Можно пропустить git pull / build, передав флаги:
#   bash deploy.sh --no-pull        # не делать git pull
#   bash deploy.sh --no-build       # не пересобирать образ
#   bash deploy.sh --no-up          # не перезапускать контейнер
#   bash deploy.sh --only-migrate   # только создать таблицу и выйти
#
set -euo pipefail

# --- Цвета ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}ℹ️  $*${NC}"; }
ok()    { echo -e "${GREEN}✅ $*${NC}"; }
warn()  { echo -e "${YELLOW}⚠️  $*${NC}"; }
err()   { echo -e "${RED}❌ $*${NC}"; }

# --- Разбор флагов ---
DO_PULL=1
DO_BUILD=1
DO_UP=1
ONLY_MIGRATE=0

for arg in "$@"; do
  case "$arg" in
    --no-pull)      DO_PULL=0 ;;
    --no-build)     DO_BUILD=0 ;;
    --no-up)        DO_UP=0 ;;
    --only-migrate) ONLY_MIGRATE=1 ;;
    *) err "Неизвестный флаг: $arg"; exit 1 ;;
  esac
done

cd "$(dirname "$0")"

# --- Проверки ---
if [ ! -f .env ]; then
  err "Файл .env не найден. Запусти скрипт из корня проекта."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  err "docker не установлен или недоступен."
  exit 1
fi

# Docker compose v2 (docker compose) или v1 (docker-compose)
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  err "docker compose / docker-compose не найден."
  exit 1
fi
info "Использую: $DC"

# --- Чтение реквизитов БД из .env ---
# Поддерживает DATABASE_URL или отдельные DATABASE_* переменные.
get_env() {
  local key="$1"
  # Ищем KEY=value (без учёта кавычек вокруг значения)
  grep -E "^${key}=" .env 2>/dev/null | head -1 | sed -E "s/^${key}=//; s/^\"//; s/\"$//; s/^'//; s/'$//" || true
}

DB_USER="$(get_env DATABASE_USER)"
DB_NAME="$(get_env DATABASE_NAME)"
DB_PASS="$(get_env DATABASE_PASSWORD)"
PG_SERVICE="postgres"   # имя сервиса в docker-compose.yml

# Если DATABASE_USER не задан — пробуем вытащить из DATABASE_URL
if [ -z "$DB_USER" ] || [ -z "$DB_NAME" ]; then
  DB_URL="$(get_env DATABASE_URL)"
  if [ -n "$DB_URL" ]; then
    info "DATABASE_USER/NAME не заданы — разбираю DATABASE_URL: $DB_URL"
    # postgresql://USER:PASS@HOST:PORT/NAME
    DB_USER="$(echo "$DB_URL" | sed -E 's#^postgresql?://([^:]+):.*#\1#')"
    DB_PASS="$(echo "$DB_URL" | sed -E 's#^postgresql?://[^:]+:([^@]+)@.*#\1#')"
    DB_NAME="$(echo "$DB_URL" | sed -E 's#.*/([^/?]+).*$#\1#')"
  fi
fi

# Fallback: если ничего не нашли — пробуем superuser postgres (дефолт docker-compose)
if [ -z "$DB_USER" ]; then
  warn "DATABASE_USER не найден в .env — использую 'postgres'."
  DB_USER="postgres"
fi
if [ -z "$DB_NAME" ]; then
  warn "DATABASE_NAME не найден в .env — использую 'vpnoodles'."
  DB_NAME="vpnoodles"
fi

info "Реквизиты БД: user=$DB_USER, db=$DB_NAME, service=$PG_SERVICE"

SQL_FILE="src/infrastructure/db/migrations/001_notification_logs.sql"
if [ ! -f "$SQL_FILE" ]; then
  err "SQL-файл не найден: $SQL_FILE"
  err "Сначала сделай git pull."
  exit 1
fi

# --- 1. git pull ---
if [ "$DO_PULL" -eq 1 ]; then
  info "Обновляю код (git pull)..."
  git pull
  ok "Код обновлён"
fi

# --- 2. Создание таблицы ---
info "Создаю таблицу notification_logs (безопасно, IF NOT EXISTS)..."

# Сначала проверим, существует ли уже таблица — чтобы лишний раз не дёргать psql.
TABLE_EXISTS="$($DC exec -T -e PGPASSWORD="$DB_PASS" "$PG_SERVICE" \
  psql -U "$DB_USER" -d "$DB_NAME" -tAc \
  "SELECT to_regclass('notification_logs');" 2>/dev/null || true)"

if [ "$TABLE_EXISTS" = "notification_logs" ]; then
  ok "Таблица notification_logs уже существует — пропуск"
else
  $DC exec -T -e PGPASSWORD="$DB_PASS" "$PG_SERVICE" \
    psql -U "$DB_USER" -d "$DB_NAME" < "$SQL_FILE"
  ok "Таблица notification_logs создана"
fi

# Проверка
ROW_COUNT="$($DC exec -T -e PGPASSWORD="$DB_PASS" "$PG_SERVICE" \
  psql -U "$DB_USER" -d "$DB_NAME" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_name='notification_logs';" 2>/dev/null || echo "0")"

if [ "$(echo "$ROW_COUNT" | tr -d '[:space:]')" = "1" ]; then
  ok "Проверка: таблица на месте"
else
  err "Что-то пошло не так — таблица не найдена после миграции"
  exit 1
fi

if [ "$ONLY_MIGRATE" -eq 1 ]; then
  ok "Только миграция (--only-migrate) — выхожу"
  exit 0
fi

# --- 3. Пересборка образа ---
if [ "$DO_BUILD" -eq 1 ]; then
  info "Пересобираю Docker-образ..."
  $DC build app
  ok "Образ собран"
fi

# --- 4. Перезапуск бота ---
if [ "$DO_UP" -eq 1 ]; then
  info "Перезапускаю бот..."
  $DC up -d app
  ok "Контейнер app запущен"
fi

echo ""
ok "Готово! Деплой завершён."
info "Логи: $DC logs -f app --tail 50"
