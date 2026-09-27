FROM node:22-slim

WORKDIR /app

# procps: `ps`/`pkill` for debugging inside the container
RUN apt-get update && \
    apt-get install -y --no-install-recommends procps && \
    rm -rf /var/lib/apt/lists/*

# Install dependencies first, so this layer is cached until package*.json changes
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

COPY . .

# The node user must be able to write primary.pid, output.log,
# cache versions (?v=) in static files and schema snapshots.
RUN chown -R node:node /app
USER node

ENV ENV=prod
EXPOSE 443 80

CMD ["node", "web-app/main.js"]
