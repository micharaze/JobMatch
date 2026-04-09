FROM node:20-slim

WORKDIR /app

COPY package*.json ./
COPY shared/ ./shared/
COPY services/validator/ ./services/validator/

RUN npm install

RUN npm run build -w @jobcheck/shared
RUN npm run build -w @jobcheck/validator

WORKDIR /app/services/validator

EXPOSE 3005

CMD ["node", "dist/index.js"]
