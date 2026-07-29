#!/usr/bin/env bash
#
# Перенос БД (Postgres) на новый VPS. Redis НЕ переносится — там только
# короткоживущие локи оплаты и кэш статуса подписки (TTL секунды/минуты),
# терять нечего, на новом сервере он просто стартует пустым.
#
# На СТАРОМ сервере (там, где сейчас реально работает бот):
#   bash migrate-vps.sh --export
#   → создаст vpnoodles_backup_<timestamp>.sql.gz в текущей директории.
#   Перенеси этот файл на новый сервер, например:
#   scp vpnoodles_backup_*.sql.gz user@new-vps:/path/to/vpnoodles2/
#
# На НОВОМ сервере (postgres должен быть уже поднят: `docker compose up -d postgres`,
# приложение (app) — ЕЩЁ НЕТ, чтобы не начать писать в БД до того, как дамп восстановлен):
#   bash migrate-vps.sh --import vpnoodles_backup_<timestamp>.sql.gz
#
# Проверить количество строк в ключевых таблицах в любой момент:
#   bash migrate-vps.sh --verify
#
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}ℹ️  $*${NC}"; }
ok()    { echo -e "${GREEN}✅ $*${NC}"; }
warn()  { echo -e "${YELLOW}⚠️  $*${NC}"; }
err()   { echo -e "${RED}❌ $*${NC}"; }

cd "$(dirname "$0")"

MODE=""
IMPORT_FILE=""
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --export)  MODE="export"; shift ;;
    --import)  MODE="import"; IMPORT_FILE="${2:-}"; shift 2 ;;
    --verify)  MODE="verify"; shift ;;
    --force)   FORCE=1; shift ;;
    *) err "Неизвестный аргумент: $1"; exit 1 ;;
  esac
done

if [ -z "$MODE" ]; then
  err "Укажи режим: --export | --import <файл> | --verify"
  exit 1
fi

# --- Проверки окружения ---
if [ ! -f .env ]; then
  err "Файл .env не найден. Запусти скрипт из корня проекта."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  err "docker не установлен или недоступен."
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  err "docker compose / docker-compose не найден."
  exit 1
fi

# --- Реквизиты БД из .env (тот же способ, что в deploy.sh) ---
get_env() {
  local key="$1"
  grep -E "^${key}=" .env 2>/dev/null | head -1 | sed -E "s/^${key}=//; s/^\"//; s/\"$//; s/^'//; s/'$//" || true
}

DB_USER="$(get_env DATABASE_USER)"
DB_NAME="$(get_env DATABASE_NAME)"
DB_PASS="$(get_env DATABASE_PASSWORD)"
PG_SERVICE="postgres"

if [ -z "$DB_USER" ] || [ -z "$DB_NAME" ]; then
  DB_URL="$(get_env DATABASE_URL)"
  if [ -n "$DB_URL" ]; then
    info "DATABASE_USER/NAME не заданы — разбираю DATABASE_URL"
    DB_USER="$(echo "$DB_URL" | sed -E 's#^postgresql?://([^:]+):.*#\1#')"
    DB_PASS="$(echo "$DB_URL" | sed -E 's#^postgresql?://[^:]+:([^@]+)@.*#\1#')"
    DB_NAME="$(echo "$DB_URL" | sed -E 's#.*/([^/?]+).*$#\1#')"
  fi
fi
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-vpnoodles}"

info "Реквизиты БД: user=$DB_USER, db=$DB_NAME, service=$PG_SERVICE"

wait_for_postgres() {
  info "Проверяю, что контейнер postgres поднят и отвечает..."
  for _ in $(seq 1 15); do
    if $DC exec -T "$PG_SERVICE" pg_isready -U "$DB_USER" >/dev/null 2>&1; then
      ok "Postgres готов"
      return 0
    fi
    sleep 2
  done
  err "Postgres не отвечает. Подними его: $DC up -d postgres"
  exit 1
}

row_counts() {
  $DC exec -T -e PGPASSWORD="$DB_PASS" "$PG_SERVICE" psql -U "$DB_USER" -d "$DB_NAME" -tAc "
    SELECT 'users: ' || (SELECT count(*) FROM users)
    UNION ALL SELECT 'subscriptions: ' || (SELECT count(*) FROM subscriptions)
    UNION ALL SELECT 'payments: ' || (SELECT count(*) FROM payments)
    UNION ALL SELECT 'audit_logs: ' || (SELECT count(*) FROM audit_logs);
  " 2>/dev/null || echo "(таблицы ещё не созданы)"
}

case "$MODE" in
  export)
    wait_for_postgres
    OUTFILE="vpnoodles_backup_$(date +%Y%m%d_%H%M%S).sql.gz"
    info "Делаю дамп базы $DB_NAME в $OUTFILE ..."
    $DC exec -T -e PGPASSWORD="$DB_PASS" "$PG_SERVICE" \
      pg_dump -U "$DB_USER" -d "$DB_NAME" | gzip > "$OUTFILE"
    ok "Дамп готов: $OUTFILE ($(du -h "$OUTFILE" | cut -f1))"
    echo ""
    info "Текущие данные в дампе:"
    row_counts
    echo ""
    info "Дальше: перенеси файл на новый сервер, например —"
    echo "  scp $OUTFILE user@new-vps:/path/to/vpnoodles2/"
    ;;

  import)
    if [ -z "$IMPORT_FILE" ]; then
      err "Укажи файл дампа: --import <файл>"
      exit 1
    fi
    if [ ! -f "$IMPORT_FILE" ]; then
      err "Файл не найден: $IMPORT_FILE"
      exit 1
    fi

    wait_for_postgres

    # Защита от случайного затирания уже наполненной БД на новом сервере.
    EXISTING_USERS="$($DC exec -T -e PGPASSWORD="$DB_PASS" "$PG_SERVICE" \
      psql -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT count(*) FROM users;" 2>/dev/null || echo "0")"
    EXISTING_USERS="$(echo "$EXISTING_USERS" | tr -d '[:space:]')"

    if [ "${EXISTING_USERS:-0}" != "0" ] && [ "$FORCE" -ne 1 ]; then
      err "В базе $DB_NAME уже есть $EXISTING_USERS пользователей — похоже, туда уже что-то писали."
      err "Импорт поверх существующих данных может всё перепутать/задвоить."
      err "Если это точно нужно — повтори с флагом --force (перед этим сам реши, что делать со старыми строками)."
      exit 1
    fi

    info "Восстанавливаю $IMPORT_FILE в базу $DB_NAME ..."
    gunzip -c "$IMPORT_FILE" | $DC exec -T -e PGPASSWORD="$DB_PASS" "$PG_SERVICE" \
      psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME"
    ok "Восстановление завершено"
    echo ""
    info "Проверка — сравни эти числа с тем, что показал --export на старом сервере:"
    row_counts
    echo ""
    warn "Не забудь: docker compose up -d --build app — только теперь, когда БД на месте."
    warn "И убедись, что бот на СТАРОМ сервере уже остановлен (docker compose stop app),"
    warn "прежде чем поднимать новый — иначе будет гонка/конфликт по Telegram."
    ;;

  verify)
    wait_for_postgres
    info "Текущие данные в базе $DB_NAME:"
    row_counts
    ;;
esac
