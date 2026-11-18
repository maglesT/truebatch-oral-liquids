# TrueBatch Tablets Packing: the same repository and server as TrueBatch Tablets, started as the packing product with
# its own web UI and its own database (packing/migrate.ts).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/db/migrations ./db/migrations
COPY --from=build /app/packing/migrations ./packing/migrations
COPY --from=build /app/server/fonts ./server/fonts
COPY package.json ./
USER node
EXPOSE 3000
CMD ["sh", "-c", "node dist/packing/migrate.js && node dist/packing/server/index.js"]
