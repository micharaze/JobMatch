FROM node:20-slim

WORKDIR /app

COPY package*.json ./
COPY tsconfig.base.json ./
COPY shared/ ./shared/
COPY services/normalizer/ ./services/normalizer/

RUN npm install

RUN npm run build -w @jobcheck/shared
RUN npm run build -w @jobcheck/normalizer

WORKDIR /app/services/normalizer

EXPOSE 3002

CMD ["node", "dist/index.js"]
