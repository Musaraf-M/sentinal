FROM node:22-slim

WORKDIR /app

COPY platforms/mcp/package.json ./
COPY platforms/mcp/tsconfig.json ./
COPY platforms/mcp/src/ ./src/

RUN npm install
RUN npx tsc

ENTRYPOINT ["node", "dist/index.js"]
