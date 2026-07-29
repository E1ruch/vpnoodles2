#!/usr/bin/env bash
#
# Деплой на проде (VPS): git pull → пересборка образа → синхронизация схемы БД
# (migrate:safe, недеструктивно — только создаёт недостающее) → перезапуск →
# проверка, что контейнер реально поднялся и остался жив.
#
# Запуск с корня проекта:
#   bash deploy.sh
#
# Можно пропустить git pull / build, передав флаги:
#   bash deploy.sh --no-pull        # не делать git pull
#   bash deploy.sh --no-build       # не пересобирать образ
#   bash deploy.sh --no-up          # не перезапускать контейнер
#   bash deploy.sh --only-migrate   # только синхронизировать схему и выйти
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

get_env() {
  local key="$1"
  grep -E "^${key}=" .env 2>/dev/null | head -1 | sed -E "s/^${key}=//; s/^\"//; s/\"\$//; s/^'//; s/'\$//" || true
}

# --- 1. git pull ---
if [ "$DO_PULL" -eq 1 ]; then
  info "Обновляю код (git pull)..."
  git pull
  ok "Код обновлён"
fi

# --- 2. Пересборка образа (нужна ДО миграции — синхронизация схемы бежит
#         внутри свежего образа, чтобы видеть актуальные entity-классы) ---
if [ "$DO_BUILD" -eq 1 ]; then
  info "Пересобираю Docker-образ..."
  $DC build app
  ok "Образ собран"
fi

# --- 3. Синхронизация схемы БД ---
# migrate:safe = TypeORM synchronize() БЕЗ dropBeforeSync: создаёт недостающие
# таблицы/колонки под текущие entity-классы, ничего не удаляет и не трогает
# существующие данные. Общий механизм для любых будущих изменений схемы —
# не нужно на каждую новую колонку дописывать отдельный SQL-файл и шаг сюда.
info "Синхронизирую схему БД (migrate:safe, недеструктивно)..."
$DC run --rm -T app node dist/infrastructure/db/migrate-safe.js
ok "Схема синхронизирована"

if [ "$ONLY_MIGRATE" -eq 1 ]; then
  ok "Только миграция (--only-migrate) — выхожу"
  exit 0
fi

# --- 4. Перезапуск бота ---
if [ "$DO_UP" -eq 1 ]; then
  info "Перезапускаю бот..."
  $DC up -d app
  ok "Контейнер app запущен"

  # --- 5. Проверка, что контейнер реально поднялся и не упал сразу же ---
  info "Проверяю, что контейнер остался жив..."
  APP_OK=0
  APP_STATE="нет контейнера"
  for _ in $(seq 1 8); do
    sleep 2
    APP_CID="$($DC ps -q app 2>/dev/null || true)"
    if [ -z "$APP_CID" ]; then
      continue
    fi
    APP_STATE="$(docker inspect -f '{{.State.Status}}' "$APP_CID" 2>/dev/null || echo "unknown")"
    if [ "$APP_STATE" = "running" ]; then
      APP_OK=1
      break
    fi
    if [ "$APP_STATE" = "exited" ] || [ "$APP_STATE" = "dead" ]; then
      break
    fi
  done

  if [ "$APP_OK" -ne 1 ]; then
    err "Контейнер app не поднялся (состояние: '$APP_STATE')."
    err "Логи: $DC logs app --tail 100"
    exit 1
  fi
  ok "Контейнер работает"

  APP_PORT="$(get_env PORT)"
  APP_PORT="${APP_PORT:-3000}"
  if command -v curl >/dev/null 2>&1 && curl -fsS "http://127.0.0.1:${APP_PORT}/health" >/dev/null 2>&1; then
    ok "/health отвечает"
  else
    warn "/health не ответил — контейнер запущен, но стоит проверить логи вручную: $DC logs app --tail 100"
  fi
fi

echo ""
ok "Готово! Деплой завершён."
info "Логи: $DC logs -f app --tail 50"
