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
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /ms-playwright /ms-playwright
RUN useradd -m appuser && chown -R appuser:appuser /app /ms-playwright
USER appuser
EXPOSE 3000
CMD ["node", "dist/main.js"]
