#!/usr/bin/env bash
# Encode a source WAV into opus, mp3, and flac for the format comparison demo.
#
# Usage: ./encode-samples.sh source.wav
#
# Requires ffmpeg with libopus and libmp3lame support.
# On macOS: brew install ffmpeg

set -euo pipefail

INPUT="${1:?Usage: $0 <source.wav>}"
DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v ffmpeg &>/dev/null; then
  echo "Error: ffmpeg not found. Install with: brew install ffmpeg" >&2
  exit 1
fi

echo "Encoding from: $INPUT"

ffmpeg -y -i "$INPUT" -c:a libopus -b:a 128k -vn "$DIR/sample.opus"
ffmpeg -y -i "$INPUT" -c:a libmp3lame -b:a 192k -vn "$DIR/sample.mp3"
ffmpeg -y -i "$INPUT" -c:a flac -vn "$DIR/sample.flac"

echo ""
echo "Encoded sizes:"
ls -lh "$DIR"/sample.{opus,mp3,flac}
