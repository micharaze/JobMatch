FROM node:20-slim

WORKDIR /app

COPY package*.json ./
COPY shared/ ./shared/
COPY services/matcher/ ./services/matcher/

RUN npm install

RUN npm run build -w @jobcheck/shared
RUN npm run build -w @jobcheck/matcher

WORKDIR /app/services/matcher

EXPOSE 3004

CMD ["node", "dist/index.js"]
