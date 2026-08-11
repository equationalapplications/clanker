FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY shared/ ./shared/
COPY cloud-agent/ ./cloud-agent/
WORKDIR /app/cloud-agent
RUN npm ci
RUN ln -sfn /app/cloud-agent/node_modules /app/node_modules
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app/cloud-agent
COPY --from=builder /app/cloud-agent/package*.json ./
COPY --from=builder /app/cloud-agent/node_modules ./node_modules
COPY --from=builder /app/cloud-agent/dist ./dist
EXPOSE 8080
USER node
CMD ["npm", "start"]
