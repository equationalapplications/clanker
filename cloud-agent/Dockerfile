FROM node:22-bullseye-slim AS builder
WORKDIR /app
COPY shared/ ./shared/
COPY cloud-agent/ ./cloud-agent/
WORKDIR /app/cloud-agent
RUN npm ci
RUN ln -s /app/cloud-agent/node_modules /app/node_modules
RUN npm run build

FROM node:22-bullseye-slim
WORKDIR /app/cloud-agent
COPY --from=builder /app/cloud-agent/package*.json ./
COPY --from=builder /app/cloud-agent/node_modules ./node_modules
COPY --from=builder /app/cloud-agent/dist ./dist
EXPOSE 8080
CMD ["npm", "start"]
