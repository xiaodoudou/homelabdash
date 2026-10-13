# syntax=docker/dockerfile:1

# The page: built once with Vite, only its output goes into the image.
FROM node:24-alpine AS page
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY vite.config.js ./
COPY web ./web
RUN npm run build

FROM node:24-alpine

ENV NODE_ENV=production \
    HOMELABDASH_CONFIG=/config \
    HOMELABDASH_DATA=/data \
    PORT=3000

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY LICENSE NOTICE ./
COPY bin ./bin
COPY src ./src
COPY sdk ./sdk
COPY plugins ./plugins
COPY templates ./templates
COPY examples ./examples
COPY --from=page /app/dist ./dist

RUN chmod +x bin/homelabdash.js \
 && ln -s /app/bin/homelabdash.js /usr/local/bin/homelabdash \
 && mkdir -p /config /data \
 && chown node:node /config /data

USER node
EXPOSE 3000
VOLUME ["/config", "/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" > /dev/null || exit 1
CMD ["node", "/app/bin/homelabdash.js", "serve"]
