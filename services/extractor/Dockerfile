FROM node:20-slim

WORKDIR /app

COPY package*.json ./
COPY shared/ ./shared/
COPY services/extractor/ ./services/extractor/

RUN npm install

RUN npm run build -w @jobcheck/shared
RUN npm run build -w @jobcheck/extractor

WORKDIR /app/services/extractor

EXPOSE 3002

CMD ["node", "dist/index.js"]
