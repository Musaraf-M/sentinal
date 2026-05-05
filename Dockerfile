FROM node:22-slim

WORKDIR /app

COPY platforms/mcp/package.json ./
RUN npm install --omit=dev

COPY platforms/mcp/dist/ ./dist/

ENTRYPOINT ["node", "dist/index.js"]
