# ---- build stage: install workspaces, build web static + typecheck api ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
# postinstall (cesium asset copy) needs the sources; install deps first without scripts
RUN npm ci --ignore-scripts
COPY . .
RUN node apps/web/scripts/copy-cesium-assets.js \
  && npm run build -w packages/shared -w apps/api -w apps/web

# ---- runtime: API serves /api + the built web app ----
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/packages/shared/package.json packages/shared/
RUN npm ci --ignore-scripts --omit=dev
COPY --from=build /app/apps/api/src apps/api/src
COPY --from=build /app/apps/api/seed apps/api/seed
COPY --from=build /app/packages/shared/src packages/shared/src
COPY --from=build /app/apps/web/dist apps/web/dist

# non-root
RUN mkdir -p /data && chown -R node:node /data /app
USER node

ENV PORT=8787 \
    DATA_DIR=/data \
    WEB_DIST=/app/apps/web/dist
EXPOSE 8787
CMD ["node", "apps/api/src/index.ts"]
