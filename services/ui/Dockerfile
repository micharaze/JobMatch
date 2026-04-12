FROM node:20-slim

WORKDIR /app

# Copy workspace files
COPY package*.json ./
COPY services/ui/package.json ./services/ui/

# Install dependencies
RUN npm install

COPY services/ui/ ./services/ui/

WORKDIR /app/services/ui

RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "preview"]
