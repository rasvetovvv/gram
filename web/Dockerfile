FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_API_URL=https://vexory.xyz
ARG NEXT_PUBLIC_GRAM_WIRE_ENABLED=false
ARG NEXT_PUBLIC_GRAM_WIRE_PRIMARY=false
ARG NEXT_PUBLIC_GRAM_WIRE_CANARY_ONLY=true
ARG NEXT_PUBLIC_GRAM_WIRE_URL=wss://vexory.xyz/wire
ARG NEXT_PUBLIC_GRAM_WIRE_IDENTITY_PUBLIC_KEY_B64=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_GRAM_WIRE_ENABLED=$NEXT_PUBLIC_GRAM_WIRE_ENABLED \
    NEXT_PUBLIC_GRAM_WIRE_PRIMARY=$NEXT_PUBLIC_GRAM_WIRE_PRIMARY \
    NEXT_PUBLIC_GRAM_WIRE_CANARY_ONLY=$NEXT_PUBLIC_GRAM_WIRE_CANARY_ONLY \
    NEXT_PUBLIC_GRAM_WIRE_URL=$NEXT_PUBLIC_GRAM_WIRE_URL \
    NEXT_PUBLIC_GRAM_WIRE_IDENTITY_PUBLIC_KEY_B64=$NEXT_PUBLIC_GRAM_WIRE_IDENTITY_PUBLIC_KEY_B64
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
