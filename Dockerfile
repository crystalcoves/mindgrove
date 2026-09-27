# Mindgrove on Fly.io: build the PWA with Node, then run the tiny dependency-free
# server (server/server.mjs) that serves it and stores encrypted sync blobs on
# the /data volume.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data DIST_DIR=/app/dist
COPY --from=build /app/dist ./dist
COPY server/server.mjs ./server/server.mjs
EXPOSE 8080
CMD ["node", "server/server.mjs"]
