# Use a specific Node.js version for better reproducibility
FROM node:23.3.0-slim AS builder

# Install pnpm globally and necessary build tools
RUN npm install -g pnpm@9.4.0 && \
    apt-get update && \
    apt-get upgrade -y && \
    apt-get install -y \
        git \
        python3 \
        python3-pip \
        curl \
        node-gyp \
        ffmpeg \
        libtool-bin \
        autoconf \
        automake \
        libopus-dev \
        make \
        g++ \
        build-essential \
        libcairo2-dev \
        libjpeg-dev \
        libpango1.0-dev \
        libgif-dev \
        openssl \
        libssl-dev && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Set Python 3 as the default python
RUN ln -sf /usr/bin/python3 /usr/bin/python

ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip

# Set the working directory
WORKDIR /app

# Copy application code
COPY . .

# Install dependencies
RUN pnpm install --no-frozen-lockfile

# ---------------------------
# Build Core
# ---------------------------
RUN pnpm run build --filter="./packages/core"

# ---------------------------
# Build Adapters
# ---------------------------
RUN pnpm run build --filter="./packages/adapter-redis" && \
    pnpm run build --filter="./packages/adapter-mongodb" && \
    pnpm run build --filter="./packages/adapter-postgres" && \
    pnpm run build --filter="./packages/adapter-sqlite" && \
    pnpm run build --filter="./packages/adapter-sqljs" && \
    pnpm run build --filter="./packages/adapter-qdrant" && \
    pnpm run build --filter="./packages/adapter-supabase"

# ---------------------------
# Build Clients in chunks
# ---------------------------
RUN pnpm run build --filter="./packages/client-[a-d]*"
RUN pnpm run build --filter="./packages/client-[e-l]*"
RUN pnpm run build --filter="./packages/client-[m-s]*"
RUN pnpm run build --filter="./packages/client-[t-z]*"

# ---------------------------
# Build create-eliza-app
# ---------------------------
RUN pnpm run build --filter="./packages/create-eliza-app"

# ---------------------------
# Build Plugins in smaller chunks
# ---------------------------
RUN pnpm run build --filter="./packages/plugin-[a-d]*"
RUN pnpm run build --filter="./packages/plugin-[e-h]*"
RUN pnpm run build --filter="./packages/plugin-[i-l]*"
RUN pnpm run build --filter="./packages/plugin-[m-p]*"
RUN pnpm run build --filter="./packages/plugin-[q-t]*"
RUN pnpm run build --filter="./packages/plugin-[u-z]*"

# ---------------------------
# Build transformers
# ---------------------------
RUN pnpm run build --filter="./packages/rpc-transformers"

# Final Cleanup
RUN pnpm prune --prod

# Final runtime image
FROM node:23.3.0-slim

# Install runtime dependencies
RUN npm install -g pnpm@9.4.0 && \
    apt-get update && \
    apt-get install -y \
        git \
        python3 \
        ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Copy built artifacts and production dependencies from the builder stage
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/.npmrc ./
COPY --from=builder /app/turbo.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/agent ./agent
COPY --from=builder /app/client ./client
COPY --from=builder /app/lerna.json ./
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/characters ./characters

# Expose necessary ports
EXPOSE 3000 5173

# Command to start the application
CMD ["sh", "-c", "pnpm start & pnpm start:client"]
