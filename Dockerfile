FROM node:26-alpine AS builder
WORKDIR /app

# Install dependencies based on lockfile
COPY package*.json ./
RUN npm ci

# Copy source code and build static assets
COPY . .
RUN npm run build

FROM caddy:2-alpine AS runner

COPY --from=builder /app/Caddyfile /etc/caddy
COPY --from=builder /app/dist /srv

EXPOSE 80

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile"]
