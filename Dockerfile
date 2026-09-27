# Mindgrove on Fly.io: build the static app with Node, serve it with nginx.
# The app is fully client-side (data lives in the browser), so the server is
# just a tiny static file host.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
