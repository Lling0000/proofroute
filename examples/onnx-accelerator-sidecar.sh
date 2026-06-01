#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

cd "$ROOT_DIR"

MODEL_PATH="${PROOFROUTE_ONNX_MODEL:-${PROOFROUTE_ACCELERATOR_MODEL:-examples/linear-intent-model.onnx}}"

if [ ! -f "$MODEL_PATH" ]; then
  printf '%s\n' "proofroute ONNX sidecar cannot read $MODEL_PATH. Run node ./examples/export-linear-intent-onnx.js --out examples/linear-intent-model.onnx or set PROOFROUTE_ONNX_MODEL." >&2
  exit 66
fi

exec node ./bin/proofroute-classifier.js \
  --port "${PROOFROUTE_CLASSIFIER_PORT:-8788}" \
  --warmup \
  --require-warmup \
  --backend "${PROOFROUTE_CLASSIFIER_BACKEND:-onnx-runtime}" \
  --lanes "${PROOFROUTE_GPU_LANES:-2}" \
  --devices "${PROOFROUTE_ACCELERATOR_DEVICES:-0,1}" \
  --scheduler "${PROOFROUTE_GPU_SCHEDULER:-least-inflight}" \
  --batch-window-ms "${PROOFROUTE_CLASSIFIER_BATCH_WINDOW_MS:-0}" \
  --max-batch-size "${PROOFROUTE_CLASSIFIER_MAX_BATCH_SIZE:-16}" \
  --persistent-command "node ./examples/accelerator-worker.js" \
  --accelerator-module "${PROOFROUTE_ACCELERATOR_MODULE:-examples/onnx-accelerator-module.js}" \
  --accelerator-model "$MODEL_PATH"
