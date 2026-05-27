# studio-server — Hono + AI SDK backend agentico per Studio Futuro.
# Build a 2 stage: deps + build (typecheck via tsc) -> runner slim.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --include=dev --ignore-scripts

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8790
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
# Persistent data dir — mount a Coolify volume here:
# PENDING_SCHOOLS_EXPORT_DIR=/data/portals (env var in Coolify)
# Volume: /data/portals → host persistent directory
RUN mkdir -p /data/portals/logos
EXPOSE 8790
CMD ["node", "dist/index.js"]
