FROM node:20-slim

WORKDIR /app

COPY package*.json ./
COPY shared/ ./shared/
COPY services/scorer/ ./services/scorer/

RUN npm install

RUN npm run build -w @jobcheck/shared
RUN npm run build -w @jobcheck/scorer

WORKDIR /app/services/scorer

EXPOSE 3006

CMD ["node", "dist/index.js"]
