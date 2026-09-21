#!/usr/bin/env bash
# Дев-версия: берёт свежую копию продовой БД и поднимает дев-контейнер с ней.
# Git-обновление кода делает вызывающая сторона (workflow), как и в scripts/deploy.sh.
#
# Копируем — и всё: никаких миграций, чисток и переносов. Прод пишет data.json
# атомарно (tmp+rename), поэтому обычный cp во время работы прода читает целый файл
# (старый либо новый inode — оба валидны), блокировки не нужны. Сессию и прочие
# директории (presence-log/event-photos/...) НЕ трогаем: у дева свой BOT_TOKEN → своя
# сессия, а «бд» — это только data.json.
set -euo pipefail

cd "$(dirname "$0")/.."

# Директория продового чекаута на этом же хосте. Переопределяется переменной.
PROD_DIR="${PROD_DIR:-/home/renat/endpoint-robot}"
PROD_DB="$PROD_DIR/bot-data/data.json"
DEV_DB="./bot-data/data.json"

if [ ! -f "$PROD_DB" ]; then
  echo "[dev-seed] продовая БД не найдена: $PROD_DB — не с чем стартовать" >&2
  exit 1
fi

mkdir -p ./bot-data
cp -f "$PROD_DB" "$DEV_DB"
echo "[dev-seed] скопировал $PROD_DB → $DEV_DB ($(wc -c < "$DEV_DB") байт)"

# Запуск с этой БД. Новый коммит на каждом деплое → docker compose up пересобирает
# образ и пересоздаёт контейнер, поэтому бот стартует уже с только что скопированным
# data.json (том ./bot-data монтируется внутрь).
bash scripts/deploy.sh
