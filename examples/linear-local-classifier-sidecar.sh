#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
DEFAULT_DEVICE_PROFILES='{"cpu":{"name":"local CPU","runtime":"node","source":"manual"}}'

cd "$ROOT_DIR"

exec node ./bin/proofroute-classifier.js \
  --port "${PROOFROUTE_CLASSIFIER_PORT:-8788}" \
  --warmup \
  --require-warmup \
  --backend "${PROOFROUTE_CLASSIFIER_BACKEND:-linear-local-artifact}" \
  --lanes "${PROOFROUTE_GPU_LANES:-1}" \
  --devices "${PROOFROUTE_GPU_DEVICES:-cpu}" \
  --device-profiles "${PROOFROUTE_GPU_DEVICE_PROFILES:-$DEFAULT_DEVICE_PROFILES}" \
  --scheduler "${PROOFROUTE_GPU_SCHEDULER:-least-inflight}" \
  --batch-window-ms "${PROOFROUTE_CLASSIFIER_BATCH_WINDOW_MS:-0}" \
  --max-batch-size "${PROOFROUTE_CLASSIFIER_MAX_BATCH_SIZE:-16}" \
  --persistent-command "node ./examples/accelerator-worker.js" \
  --accelerator-module "${PROOFROUTE_ACCELERATOR_MODULE:-examples/linear-accelerator-module.js}" \
  --accelerator-model "${PROOFROUTE_ACCELERATOR_MODEL:-examples/linear-intent-model.json}" \
  --accelerator-devices "${PROOFROUTE_ACCELERATOR_DEVICES:-cpu}"
