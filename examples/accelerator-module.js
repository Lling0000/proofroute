import { classifyIntent } from '../src/controller/intent.js';

const warmedDevices = new Set();

export async function warmup(context = {}) {
  warmedDevices.add(String(context.device ?? 'cpu'));
}

export async function classifyMany(prompts, context = {}) {
  const device = String(context.device ?? 'cpu');
  return prompts.map((prompt, index) => {
    const intent = classifyIntent(String(prompt ?? ''));
    return {
      ...intent,
      features: {
        ...intent.features,
        module: 'example-accelerator-module',
        warmed: warmedDevices.has(device),
        ordinal: index,
        moduleDevice: device,
        moduleDeviceCount: context.deviceCount ?? 1,
        moduleScheduler: context.scheduler ?? 'round-robin',
        moduleShardSize: context.shardSize ?? prompts.length
      }
    };
  });
}
