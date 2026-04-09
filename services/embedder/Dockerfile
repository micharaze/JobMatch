FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY shared/package.json ./shared/
COPY services/embedder/package.json ./services/embedder/
RUN npm ci --workspace=@jobcheck/shared --workspace=@jobcheck/embedder
COPY shared/ ./shared/
COPY services/embedder/ ./services/embedder/
RUN npm run build -w @jobcheck/shared
RUN npm run build -w @jobcheck/embedder

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/shared/package.json ./shared/package.json
COPY --from=builder /app/services/embedder/dist ./services/embedder/dist
COPY --from=builder /app/services/embedder/package.json ./services/embedder/package.json
WORKDIR /app/services/embedder
CMD ["node", "dist/index.js"]
