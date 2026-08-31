# syntax=docker/dockerfile:1

FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY styles ./styles
# public/ is copied into the builder because `npm run build` generates app.css into it;
# the runtime stage then takes the whole directory back out.
COPY public ./public
RUN npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
# serveStatic resolves `root` against the working directory, so public/ must sit
# directly under WORKDIR. Taken from the builder so the generated CSS comes with it.
COPY --from=builder /app/public ./public

# The database lives here. Mount a volume over it or tags are lost when the
# container is replaced: docker run -v uatu-data:/app/data ...
RUN mkdir -p /app/data && chown node:node /app/data
ENV DB_PATH=/app/data/uatu.db
VOLUME /app/data

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
