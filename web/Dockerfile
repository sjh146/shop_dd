# shop_dd web — 프로덕션 빌드 (multi-stage)
# stage1: Vite 빌드 → stage2: nginx 정적 서빙 + /api 프록시
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
