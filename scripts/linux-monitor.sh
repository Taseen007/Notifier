#!/usr/bin/env bash
# Start backend and frontend in background (Linux)
set -e
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT_DIR/backend"
if [ ! -d node_modules ]; then
  npm install
fi
# start backend in background
npm run start &
BACK_PID=$!

echo "Backend started (PID $BACK_PID)"

cd "$ROOT_DIR/frontend"
if [ ! -d node_modules ]; then
  npm install
fi
npm run start &
FRONT_PID=$!

echo "Frontend started (PID $FRONT_PID)"

echo "To stop: kill $BACK_PID $FRONT_PID"