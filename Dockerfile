FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS panel-builder
WORKDIR /app/admin-panel
COPY admin-panel/package*.json ./
RUN npm ci
COPY admin-panel/ ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=panel-builder /app/admin-panel/dist ./admin-panel/dist
EXPOSE 3000 3001
CMD ["node", "dist/app/bootstrap.js"]
