FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN apk add --no-cache chromium nss freetype harfbuzz ttf-freefont && npm install --omit=dev

COPY . .

RUN mkdir -p /app/data

EXPOSE 8090

CMD ["npm", "start"]
