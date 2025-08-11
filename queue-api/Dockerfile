FROM node:20-bookworm-slim
WORKDIR /app
COPY package*.json ./
# use npm ci if you commit package-lock.json; otherwise keep install
# RUN npm ci --omit=dev
RUN npm install --omit=dev
COPY src ./src
ENV NODE_ENV=production
CMD ["node","src/index.js"]
