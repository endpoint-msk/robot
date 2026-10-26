#!/usr/bin/env bash
# Пересобирает и перезапускает контейнер из текущего рабочего дерева.
# Git-обновление делает вызывающая сторона (workflow) — скрипт не должен
# обновлять сам себя, пока bash его читает.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "[deploy] .env не найден в $(pwd) — контейнер не поднимется" >&2
  exit 1
fi

echo "[deploy] коммит: $(git rev-parse --short HEAD) $(git log -1 --pretty=%s)"

# Коммит рабочего дерева уезжает в образ: внутри контейнера git спросить не у кого.
export GIT_COMMIT="$(git rev-parse HEAD)"

docker compose up -d --build --remove-orphans

# Слои от предыдущих сборок иначе копятся до заполнения диска. Прод и дев выкатываются на
# этот хост одновременно, а второй prune Docker отклоняет («a prune operation is already
# running»). Контейнер к этому моменту уже запущен, слои доберёт следующий деплой, поэтому
# отказ чистки деплой не валит.
docker image prune -f >/dev/null || echo "[deploy] чистка образов пропущена, доберёт следующий деплой" >&2

echo "[deploy] статус:"
docker compose ps

echo "[deploy] последние логи:"
docker compose logs --tail 30 --no-color
