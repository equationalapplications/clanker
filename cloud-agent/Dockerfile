FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS builder
WORKDIR /app
COPY shared/ ./shared/
COPY cloud-agent/ ./cloud-agent/
WORKDIR /app/cloud-agent
RUN npm ci
RUN ln -sfn /app/cloud-agent/node_modules /app/node_modules
RUN npm run build

FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
WORKDIR /app/cloud-agent
COPY --from=builder /app/cloud-agent/package*.json ./
COPY --from=builder /app/cloud-agent/node_modules ./node_modules
COPY --from=builder /app/cloud-agent/dist ./dist
EXPOSE 8080
USER node
CMD ["npm", "start"]
