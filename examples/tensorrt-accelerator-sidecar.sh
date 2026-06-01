#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

cd "$ROOT_DIR"

ENGINE_PATH="${PROOFROUTE_TENSORRT_ENGINE:-${PROOFROUTE_ACCELERATOR_MODEL:-}}"

if [ -z "$ENGINE_PATH" ]; then
  printf '%s\n' "proofroute TensorRT sidecar requires PROOFROUTE_TENSORRT_ENGINE or PROOFROUTE_ACCELERATOR_MODEL because serialized TensorRT engines are hardware-specific." >&2
  exit 66
fi

if [ ! -f "$ENGINE_PATH" ]; then
  printf '%s\n' "proofroute TensorRT sidecar cannot read $ENGINE_PATH. Build a TensorRT engine for this machine and set PROOFROUTE_TENSORRT_ENGINE." >&2
  exit 66
fi

exec node ./bin/proofroute-classifier.js \
  --port "${PROOFROUTE_CLASSIFIER_PORT:-8788}" \
  --warmup \
  --require-warmup \
  --backend "${PROOFROUTE_CLASSIFIER_BACKEND:-tensorrt}" \
  --lanes "${PROOFROUTE_GPU_LANES:-2}" \
  --devices "${PROOFROUTE_ACCELERATOR_DEVICES:-0,1}" \
  --scheduler "${PROOFROUTE_GPU_SCHEDULER:-least-inflight}" \
  --batch-window-ms "${PROOFROUTE_CLASSIFIER_BATCH_WINDOW_MS:-0}" \
  --max-batch-size "${PROOFROUTE_CLASSIFIER_MAX_BATCH_SIZE:-16}" \
  --persistent-command "node ./examples/accelerator-worker.js" \
  --accelerator-module "${PROOFROUTE_ACCELERATOR_MODULE:-examples/tensorrt-accelerator-module.js}" \
  --accelerator-model "$ENGINE_PATH"
