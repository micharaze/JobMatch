FROM node:20-slim

WORKDIR /app

COPY package*.json ./
COPY tsconfig.base.json ./
COPY shared/ ./shared/
COPY services/cv/ ./services/cv/

RUN npm install

RUN npm run build -w @jobcheck/shared
RUN npm run build -w @jobcheck/cv

WORKDIR /app/services/cv

EXPOSE 3007

CMD ["node", "dist/index.js"]
