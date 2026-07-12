# Perfect 21 — single container serving the API + the site.
# Build:  docker build -t perfect21 .
# Run:    docker run -p 8721:8721 -e ADMIN_TOKEN=change-me -v p21data:/data perfect21
FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/engine ./packages/engine
COPY apps/game ./apps/game
COPY apps/server ./apps/server

# The desktop workspace (Electron) is intentionally not copied — the web
# server doesn't need it and it would bloat the image.
RUN npm install --no-audit --no-fund && npm run build

ENV PORT=8721
ENV DB_PATH=/data/perfect21.db
VOLUME /data
EXPOSE 8721

CMD ["npm", "run", "start", "-w", "@perfect21/server"]
