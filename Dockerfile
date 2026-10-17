FROM node:24-slim
WORKDIR /app

# ffmpeg for video poster thumbnails (message attachments)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data \
    DB_PATH=/app/data/skip.db

EXPOSE 3000
CMD ["node", "src/server.js"]
