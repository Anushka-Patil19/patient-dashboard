# --- Stage 1: build the React frontend -------------------------------------
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- Stage 2: API runtime that also serves the built frontend --------------
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=4000 \
    STATIC_DIR=/app/public
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY backend/src ./src
COPY --from=web /web/dist ./public
# Never run as root inside the container.
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:4000/api/health || exit 1
# Applies pending migrations, then starts the server.
CMD ["npm", "start"]
