# ── Thali Plan — production image ──
FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install dependencies first (better layer caching)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy application code
COPY server.js ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts

# Writable uploads dir owned by the unprivileged node user
RUN mkdir -p uploads && chown -R node:node /app
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
