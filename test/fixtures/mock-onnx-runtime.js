export class Tensor {
  constructor(type, data, dims) {
    this.type = type;
    this.data = data;
    this.dims = dims;
  }
}

export const InferenceSession = {
  async create(modelPath, options = {}) {
    return new MockSession(modelPath, options);
  }
};

class MockSession {
  constructor(modelPath, options) {
    this.modelPath = modelPath;
    this.options = options;
    this.inputNames = ['input'];
    this.outputNames = ['logits'];
  }

  async run(feeds) {
    const tensor = feeds.input ?? Object.values(feeds)[0];
    const rows = tensor.dims[0];
    const columns = tensor.dims[1];
    const logits = new Float32Array(rows * 6);
    for (let row = 0; row < rows; row += 1) {
      const offset = row * columns;
      const output = row * 6;
      logits[output] = score(tensor.data, offset, [2, 5, 6, 7, 8, 9]);
      logits[output + 1] = score(tensor.data, offset, [16, 17, 18]);
      logits[output + 2] = score(tensor.data, offset, [13, 14, 15]);
      logits[output + 3] = score(tensor.data, offset, [3, 10, 11, 12]);
      logits[output + 4] = score(tensor.data, offset, [1, 19, 20]);
      logits[output + 5] = score(tensor.data, offset, [21]) + 0.1;
    }
    return {
      logits: new Tensor('float32', logits, [rows, 6])
    };
  }
}

function score(data, offset, indexes) {
  return indexes.reduce((total, index) => total + Number(data[offset + index] ?? 0), 0);
}
