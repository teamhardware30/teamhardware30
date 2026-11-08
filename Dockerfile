FROM node:22-bookworm AS build
WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
RUN npx playwright install chromium --with-deps

FROM node:22-bookworm AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/views ./views
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
# Needed to run drizzle-kit migrations at boot (seed scripts run from dist/).
COPY --from=build /app/src ./src
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/sources.yaml ./sources.yaml
COPY --from=build /app/data ./data
COPY --from=build /ms-playwright /ms-playwright
RUN useradd -m appuser && chown -R appuser:appuser /app /ms-playwright
USER appuser
EXPOSE 3000
CMD ["sh", "-c", "npx drizzle-kit migrate && node dist/modules/crawler/seed-sources.js && node dist/modules/auth/seed-demo-users.js && node dist/main.js"]
