FROM node:22-alpine
WORKDIR /app

RUN apk add python3 make g++

COPY package*.json tsconfig.json ./
RUN npm install

# Мини-апп (React + Vite) собираем в webapp/dist — оттуда её раздаёт src/webapp.ts.
COPY webapp /app/webapp
RUN npm --prefix webapp install && npm --prefix webapp run build

COPY src /app/src

# Запускаем node напрямую, а не через npm: с `npm run start` PID 1 — это npm, и SIGTERM
# от `docker stop` до процесса не доходит вовсе (обработчик выключения в src/index.ts
# просто не выполнялся, докер ждал 10 с и слал SIGKILL посреди записи стейта).
CMD [ "node", "--import", "tsx", "src/index.ts" ]
