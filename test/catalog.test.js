import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentRuntime } from '../src/agent/runtime.js';
import { demoCatalog, mergeConfig } from '../src/config.js';
import { RouteController } from '../src/controller/route-controller.js';
import { renderHelp, renderModelCatalog } from '../src/view/terminal.js';

test('model catalog maps executability, leaders, and economics', () => {
  const config = mergeConfig(demoCatalog(), {
    providers: {
      openai: {
        baseUrl: 'https://example.test/v1',
        apiKey: 'test-key'
      }
    }
  });
  const controller = new RouteController(config);
  const runtime = new AgentRuntime(config);
  const report = runtime.catalog({ controller });
  assert.equal(report.summary.count, config.models.length);
  assert.ok(report.summary.executable > 1);
  assert.ok(report.intentLeaders.find((leader) => leader.intent === 'code').model);
  assert.equal(report.leaders.cheapestExecutable.id, 'llama3.2:3b');
  assert.ok(report.models.some((model) => model.id === 'gpt-4.1' && model.executable));
  const output = renderModelCatalog(report);
  assert.match(output, /MODEL MAP/);
  assert.match(output, /intent leaders/);
  assert.match(output, /gpt-4\.1/);
  assert.match(renderHelp(), /proofroute models/);
});
