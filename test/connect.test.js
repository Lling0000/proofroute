import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

test('connect view renders local OpenAI-compatible proxy environment details', () => {
  const output = renderConnect(localGatewayReport());
  assert.match(output, /PROOFROUTE_LOCAL_OPENAI_BASE_URL/);
  assert.match(output, /PROOFROUTE_LOCAL_OPENAI_MODEL/);
  assert.match(output, /proxy --port 8787$/m);
  assert.doesNotMatch(output, /--config router\.json/);
  assert.match(renderConnectShell(localGatewayReport(), 'sh'), /export PROOFROUTE_LOCAL_OPENAI_BASE_URL='http:\/\/127.0.0.1:1234\/v1'/);
});

test('connect json emits config-free proxy command for local OpenAI-compatible setup', () => {
  const result = spawnSync(process.execPath, ['./bin/proofroute.js', 'connect', '--port', '9191', '--local-openai-base-url', 'http://127.0.0.1:1234/v1', '--local-openai-model', 'qwen3', '--json'], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.env.PROOFROUTE_LOCAL_OPENAI_BASE_URL, 'http://127.0.0.1:1234/v1');
  assert.equal(output.env.PROOFROUTE_LOCAL_OPENAI_MODEL, 'qwen3');
  assert.equal(output.proxyEnv.PROOFROUTE_LOCAL_OPENAI_BASE_URL, 'http://127.0.0.1:1234/v1');
  assert.equal(output.clientEnv.OPENAI_BASE_URL, 'http://127.0.0.1:9191/v1');
  assert.equal(output.commands.startProxy, 'node ./bin/proofroute.js proxy --port 9191');
  assert.doesNotMatch(output.commands.startProxy, /--config/);
});

test('connect shell exports local OpenAI-compatible gateway variables', () => {
  const result = spawnSync(process.execPath, ['./bin/proofroute.js', 'connect', '--local-openai', 'http://127.0.0.1:1234/v1', '--local-openai-model', 'studio-local', '--shell', 'sh'], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /export OPENAI_BASE_URL='http:\/\/127.0.0.1:8787\/v1'/);
  assert.match(result.stdout, /export PROOFROUTE_LOCAL_OPENAI_BASE_URL='http:\/\/127.0.0.1:1234\/v1'/);
  assert.match(result.stdout, /export PROOFROUTE_LOCAL_OPENAI_MODEL='studio-local'/);
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

function localGatewayReport() {
  return {
    baseUrl: 'http://127.0.0.1:8787/v1',
    clientEnv: {
      OPENAI_BASE_URL: 'http://127.0.0.1:8787/v1',
      OPENAI_API_BASE: 'http://127.0.0.1:8787/v1',
      OPENAI_API_KEY: 'proofroute-local'
    },
    proxyEnv: {
      PROOFROUTE_LOCAL_OPENAI_BASE_URL: 'http://127.0.0.1:1234/v1',
      PROOFROUTE_LOCAL_OPENAI_MODEL: 'qwen3'
    },
    env: {
      OPENAI_BASE_URL: 'http://127.0.0.1:8787/v1',
      OPENAI_API_BASE: 'http://127.0.0.1:8787/v1',
      OPENAI_API_KEY: 'proofroute-local',
      PROOFROUTE_LOCAL_OPENAI_BASE_URL: 'http://127.0.0.1:1234/v1',
      PROOFROUTE_LOCAL_OPENAI_MODEL: 'qwen3'
    },
    commands: {
      startProxy: 'node ./bin/proofroute.js proxy --port 8787',
      ready: 'curl http://127.0.0.1:8787/ready',
      models: 'curl http://127.0.0.1:8787/v1/models',
      browserProof: 'node ./bin/proofroute.js smoke --proxy',
      proof: 'node ./bin/proofroute.js prove --ledger --min-requests 1'
    }
  };
}
