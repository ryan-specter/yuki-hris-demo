# No build step and no dependencies: the image is Node 24 plus src/.
# Node 24 is the minimum because the app uses the built-in node:sqlite driver.
FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    HRIS_DB=/data/hris.db

WORKDIR /app

COPY package.json ./
COPY src ./src

# /data holds the SQLite database, so it must survive the container.
RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
