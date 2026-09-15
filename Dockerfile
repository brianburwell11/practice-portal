# syntax=docker/dockerfile:1
#
# Phase 3 runtime image: Node + the two native binaries the API shells out to.
#
#   ffmpeg     — ffprobe, two-pass loudnorm, Opus transcode (server/core/media/ffmpeg.ts)
#   MuseScore  — .mscz → .mxl                               (server/core/media/musescore.ts)
#
# MuseScore is the reason this is a container on Fly rather than a Worker.
# Two things make it awkward, and both are handled below:
#
#   1. It ships as an AppImage. AppImages want FUSE, which containers don't
#      have, so we extract it at build time and run AppRun directly.
#   2. MuseScore 4 dropped `-platform offscreen` (it worked in MuseScore 3).
#      The CLI now needs a real X display even to convert a file, so every
#      invocation goes through xvfb-run. This is not optional.
#
# Build for the host arch when spiking locally; build amd64 for Fly:
#   docker build -t practice-portal-api .
#   docker build --platform linux/amd64 -t practice-portal-api .

# ---------------------------------------------------------------- stage 1
# Unpack the MuseScore AppImage. Runs on the BUILD platform, not the target:
# it only moves bytes around, so there's no reason to emulate it.
#
# We deliberately do NOT execute the AppImage. A type-2 AppImage is a squashfs
# archive appended to an ELF runtime, and `--appimage-extract` means running
# that runtime — which is static-pie linked, and QEMU user-mode emulation
# cannot exec static-pie binaries ("Exec format error", exit 126). So a
# cross-arch build can't self-extract. Instead we compute where the ELF ends,
# which is where the squashfs payload begins, and unsquashfs from that offset.
FROM --platform=$BUILDPLATFORM node:22-trixie-slim AS musescore

ARG TARGETARCH
# Pinned deliberately. MuseScore's CLI behaviour (and its crash-on-exit quirks)
# changes between point releases — server/core/media/musescore.ts already
# tolerates the 4.7.x exit-134 teardown crash. Bump both together.
ARG MUSESCORE_VERSION=4.7.5
ARG MUSESCORE_BUILD=260831071

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl binutils squashfs-tools \
    && rm -rf /var/lib/apt/lists/*

# MuseScore publishes both x86_64 and aarch64 AppImages, so this targets Fly's
# amd64 machines and an Apple Silicon laptop from the same Dockerfile.
RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) MS_ARCH=x86_64 ;; \
      arm64) MS_ARCH=aarch64 ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    url="https://github.com/musescore/MuseScore/releases/download/v${MUSESCORE_VERSION}/MuseScore-Studio-${MUSESCORE_VERSION}.${MUSESCORE_BUILD}-${MS_ARCH}.AppImage"; \
    echo "fetching ${url}"; \
    curl -fsSL -o /tmp/musescore.AppImage "${url}"; \
    offset=$(readelf -h /tmp/musescore.AppImage | awk '/Start of section headers/{s=$5} /Size of section headers/{z=$5} /Number of section headers/{n=$5} END{print s+z*n}'); \
    echo "squashfs payload starts at ${offset}"; \
    test "$(dd if=/tmp/musescore.AppImage bs=1 skip="${offset}" count=4 2>/dev/null)" = "hsqs"; \
    unsquashfs -d /opt/musescore -o "${offset}" /tmp/musescore.AppImage > /dev/null; \
    test -x /opt/musescore/AppRun; \
    rm /tmp/musescore.AppImage

# ---------------------------------------------------------------- stage 2
# Debian 13 (trixie), NOT bookworm. MuseScore 4.7.5 links against GLIBC_2.38
# and GLIBCXX_3.4.32; bookworm ships glibc 2.36 and fails at load with a wall
# of "version `GLIBC_2.38' not found". Trixie is glibc 2.41. Not arch-specific
# — the x86_64 AppImage has the same floor, so it would fail on Fly too.
FROM node:22-trixie-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl unzip \
      ffmpeg \
      # xvfb-run shells out to xauth; without it you get
      # "xvfb-run: error: xauth command not found" and exit 3.
      xvfb xauth \
      # Qt 6 runtime. The AppImage bundles a lot, but not these.
      libglib2.0-0t64 libgl1 libegl1 libopengl0 libdrm2 libgbm1 \
      libfontconfig1 libfreetype6 \
      libdbus-1-3 libnss3 libasound2t64 libpulse0 libsndfile1 \
      # libgpg-error0 is the one that actually matters: the AppImage bundles
      # libgcrypt but not its libgpg-error dependency, and without it mscore
      # dies with "error while loading shared libraries". libpipewire has an
      # AppRun fallback so it's optional — installed to keep the log clean.
      libgpg-error0 libpipewire-0.3-0 \
      libx11-6 libxext6 libxrender1 libxi6 libsm6 libice6 \
      libxcb1 libxcb-cursor0 libxcb-icccm4 libxcb-image0 libxcb-keysyms1 \
      libxcb-randr0 libxcb-render-util0 libxcb-shape0 libxcb-shm0 \
      libxcb-sync1 libxcb-xfixes0 libxcb-xinerama0 libxcb-xkb1 \
      libxkbcommon0 libxkbcommon-x11-0 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=musescore /opt/musescore /opt/musescore

# `mscore` on PATH, display faked. resolveMscoreBin() probes with `-v` and
# requires exit 0, so the wrapper must not swallow or invent a status.
RUN printf '%s\n' \
      '#!/bin/sh' \
      '# MuseScore 4 requires a display server even for CLI conversion.' \
      'exec xvfb-run -a -s "-screen 0 1280x1024x24" /opt/musescore/AppRun "$@"' \
      > /usr/local/bin/mscore \
    && chmod +x /usr/local/bin/mscore

# MuseScore writes config and a session lock under $HOME on first run; without
# a writable one it exits before converting anything.
# LANG matters: without it Qt warns that the "C" locale isn't UTF-8 and
# switches to C.UTF-8 itself. Score titles and part names carry accented
# characters, so pin the encoding rather than rely on that fallback.
ENV HOME=/home/app \
    LANG=C.UTF-8 \
    XDG_RUNTIME_DIR=/tmp/runtime \
    MUSESCORE_BIN=/usr/local/bin/mscore \
    QT_QPA_PLATFORM=xcb
RUN mkdir -p /home/app /tmp/runtime && chmod 700 /tmp/runtime

WORKDIR /app

COPY package.json package-lock.json ./
# `prepare` is `git config core.hooksPath .hooks` — local dev-hook setup that
# has no meaning here, and there's no git in this image. Dropping just that one
# script is narrower than installing git, and leaves every other lifecycle
# script (esbuild's native postinstall) running normally.
RUN npm pkg delete scripts.prepare && npm ci

COPY tsconfig.json tsconfig.node.json ./
COPY server ./server
COPY scripts ./scripts

# No server entrypoint yet — Phase 3's Hono app lands here and this becomes
# `CMD ["node", "dist/server.js"]`. Until then the image exists to prove the
# media toolchain works, via scripts/mscz-smoke.ts.
CMD ["node", "--version"]
