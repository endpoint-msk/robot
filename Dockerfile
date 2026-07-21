FROM node:20-alpine
WORKDIR /app

RUN apk add python3 make g++

COPY package*.json tsconfig.json ./
RUN npm install

# Мини-апп (React + Vite) собираем в webapp/dist — оттуда её раздаёт src/webapp.ts.
COPY webapp /app/webapp
RUN npm --prefix webapp install && npm --prefix webapp run build

COPY src /app/src

CMD [ "npm", "run", "start" ]
