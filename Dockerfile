FROM node:20-alpine
WORKDIR /app

RUN apk add python3 make g++ 
    #&& \
    #corepack enable && \
    #corepack prepare pnpm@10 --activate

COPY package*.json tsconfig.json ./
RUN npm install #--frozen-lockfile

COPY src /app/src
COPY webapp /app/webapp
#RUN pnpm run build

CMD [ "npm", "run", "start" ]
