FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_ORIGIN
ARG VITE_TEACHER_ORIGIN
ENV VITE_API_ORIGIN=$VITE_API_ORIGIN VITE_TEACHER_ORIGIN=$VITE_TEACHER_ORIGIN
RUN npm run build && npm run check:production

FROM nginxinc/nginx-unprivileged:1.28-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/default.conf.template /etc/nginx/templates/default.conf.template
ENV NGINX_ENVSUBST_FILTER="^(API_ORIGIN|TEACHER_ORIGIN)$"
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=6 CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
