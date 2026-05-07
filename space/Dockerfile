FROM node:22-slim

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY studio ./studio

WORKDIR /app/studio
RUN npm ci
RUN npm run build

WORKDIR /app
RUN npm install --omit=dev

ENV PORT=7860
EXPOSE 7860
CMD ["node", "server.js"]
