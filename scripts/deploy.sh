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

docker compose up -d --build --remove-orphans

# Слои от предыдущих сборок иначе копятся до заполнения диска.
docker image prune -f >/dev/null

echo "[deploy] статус:"
docker compose ps

echo "[deploy] последние логи:"
docker compose logs --tail 30 --no-color
