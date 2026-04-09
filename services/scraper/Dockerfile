FROM node:20-slim

# Install Playwright system dependencies (Chromium)
RUN apt-get update && apt-get install -y \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-6 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libxshmfence1 \
    wget \
    xdg-utils \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace files
COPY package*.json ./
COPY shared/ ./shared/
COPY services/scraper/ ./services/scraper/

# Install dependencies (workspace-aware)
RUN npm install

# Install Playwright's Chromium browser
RUN cd services/scraper && npx playwright install chromium

# Build shared then scraper
RUN npm run build -w @jobcheck/shared
RUN npm run build -w @jobcheck/scraper

WORKDIR /app/services/scraper

EXPOSE 3001

CMD ["node", "dist/index.js"]
