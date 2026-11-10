#!/usr/bin/env bash
set -euo pipefail

: "${BUNDLER_OUTPUT_DIR:?BUNDLER_OUTPUT_DIR is required}"
: "${BUNDLER_ROOT_DIR:?BUNDLER_ROOT_DIR is required}"

mkdir -p "$BUNDLER_OUTPUT_DIR/nodejs"
cd "$BUNDLER_ROOT_DIR"
cp package.json package-lock.json "$BUNDLER_OUTPUT_DIR/nodejs/"
# Lambda は arm64。手元が x86_64 でも arm64 向けのネイティブ依存を入れる
npm ci --omit=dev --cpu=arm64 --os=linux --prefix "$BUNDLER_OUTPUT_DIR/nodejs"
