FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends age postgresql-client ca-certificates wget && rm -rf /var/lib/apt/lists/* && groupadd --system floz && useradd --system --gid floz --create-home --home-dir /home/floz floz
RUN set -eux; case "$TARGETARCH" in amd64) sha='01f866e9c5f9b87c2b09116fa5d7c06695b106242d829a8bb32990c00312e891'; arch=amd64;; arm64) sha='14c8c9616cfce4636add161304353244e8de383b2e2752c0e9dad01d4c27c12c'; arch=arm64;; *) exit 1;; esac; wget -q "https://github.com/minio/mc/releases/download/RELEASE.2025-08-13T08-35-41Z/mc.linux-$arch.RELEASE.2025-08-13T08-35-41Z" -O /usr/local/bin/mc; echo "$sha  /usr/local/bin/mc" | sha256sum -c -; chmod 0755 /usr/local/bin/mc
USER floz
ENTRYPOINT ["node"]
