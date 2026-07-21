# Build every workspace once, then select the API, worker, or web runtime target.
FROM node:22-bookworm AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/nodes/package.json packages/nodes/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
RUN npm ci

COPY . .
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages

FROM runtime AS api
EXPOSE 3000
CMD ["node", "packages/server/dist/bootstrap.js"]

FROM runtime AS worker
CMD ["node", "packages/server/dist/worker-bootstrap.js"]

FROM nginxinc/nginx-unprivileged:1.27-alpine AS web
COPY gcp/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/web/dist /usr/share/nginx/html
EXPOSE 8080
