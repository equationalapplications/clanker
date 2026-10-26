FROM node:25-bookworm-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370 AS builder
WORKDIR /app
COPY shared/ ./shared/
COPY cloud-agent/ ./cloud-agent/
WORKDIR /app/cloud-agent
RUN npm ci
RUN ln -sfn /app/cloud-agent/node_modules /app/node_modules
RUN npm run build

FROM node:25-bookworm-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370
WORKDIR /app/cloud-agent
COPY --from=builder /app/cloud-agent/package*.json ./
COPY --from=builder /app/cloud-agent/node_modules ./node_modules
COPY --from=builder /app/cloud-agent/dist ./dist
EXPOSE 8080
USER node
CMD ["npm", "start"]
