# RepoJudge execution sandbox (spec §9): multi-language toolchain, runs as non-root uid 1000.
# Build: docker compose --profile sandbox build sandbox   (tags repojudge-sandbox:latest)
FROM debian:bookworm-slim

ARG NODE_VERSION=22.11.0
ARG GO_VERSION=1.23.4

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    PATH=/usr/local/go/bin:/opt/cargo/bin:/usr/local/node/bin:$PATH \
    CARGO_HOME=/opt/cargo \
    RUSTUP_HOME=/opt/rustup \
    GOPATH=/tmp/go \
    GOCACHE=/tmp/go-cache \
    npm_config_cache=/tmp/npm-cache \
    PIP_CACHE_DIR=/tmp/pip-cache

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git xz-utils build-essential pkg-config \
      python3 python3-venv python3-pip \
      openjdk-17-jdk-headless maven \
    && rm -rf /var/lib/apt/lists/*

# Node.js (official binary)
RUN curl -fsSL https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz | tar -xJ -C /usr/local \
    && mv /usr/local/node-v${NODE_VERSION}-linux-x64 /usr/local/node

# Go (official binary)
RUN curl -fsSL https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz | tar -xz -C /usr/local

# Rust (minimal profile)
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --no-modify-path \
    && chmod -R a+rX /opt/cargo /opt/rustup

RUN useradd --uid 1000 --create-home --home-dir /home/sandbox --shell /bin/bash sandbox
USER 1000:1000
WORKDIR /work
CMD ["sleep", "infinity"]
