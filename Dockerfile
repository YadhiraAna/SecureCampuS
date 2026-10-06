# syntax=docker/dockerfile:1
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/shared-kernel/security/casbin ./dist/shared-kernel/security/casbin
EXPOSE 3000
CMD ["node", "dist/main.js"]
