import test from 'node:test';
import assert from 'node:assert/strict';
import { renderConnect, renderConnectShell, renderHelp } from '../src/view/terminal.js';

test('connect view renders drop-in proxy environment details', () => {
  const output = renderConnect(report());
  assert.match(output, /DROP-IN PROXY/);
  assert.match(output, /OpenAI-compatible base URL/);
  assert.match(output, /OPENAI_BASE_URL/);
  assert.match(output, /browser proof/);
  assert.match(output, /smoke --proxy/);
  assert.match(output, /proof gate/);
  assert.match(renderConnectShell(report(), 'sh'), /export OPENAI_BASE_URL='http:\/\/127.0.0.1:8787\/v1'/);
  assert.match(renderConnectShell(report(), 'fish'), /set -gx OPENAI_API_KEY 'proofroute-local'/);
  assert.match(renderConnectShell(report(), 'powershell'), /\$env:OPENAI_API_BASE = 'http:\/\/127.0.0.1:8787\/v1'/);
  assert.match(renderHelp(), /proofroute connect/);
});

function report() {
  return {
    baseUrl: 'http://127.0.0.1:8787/v1',
    env: {
      OPENAI_BASE_URL: 'http://127.0.0.1:8787/v1',
      OPENAI_API_BASE: 'http://127.0.0.1:8787/v1',
      OPENAI_API_KEY: 'proofroute-local'
    },
    commands: {
      startProxy: 'node ./bin/proofroute.js proxy --port 8787 --config router.json',
      ready: 'curl http://127.0.0.1:8787/ready',
      models: 'curl http://127.0.0.1:8787/v1/models',
      browserProof: 'node ./bin/proofroute.js smoke --proxy',
      proof: 'node ./bin/proofroute.js prove --ledger --min-requests 1'
    }
  };
}
