FROM node:24.0.0-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build

FROM node:24.0.0-alpine AS production

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./

COPY --from=build /app/tunnel ./tunnel
COPY --from=build /app/proxy ./proxy

# 게이트웨이(tunnel/·proxy/)는 빌드하지 않고 .ts를 그대로 실행하므로, 여기서 import하는
# 파일은 원본 그대로 이미지에 있어야 한다. tunnel-outcome.ts는 Nest(src)와 게이트웨이가
# 함께 쓰는 유일한 공유 파일이라 dist가 아니라 src 경로에서 그대로 가져온다.
# 공유 파일이 늘어나면 이 줄도 함께 늘려야 한다.
COPY --from=build /app/src/tunnel/tunnel-outcome.ts ./src/tunnel/tunnel-outcome.ts

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main"]
