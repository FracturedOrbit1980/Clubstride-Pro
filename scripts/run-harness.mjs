// Run the offline-outbox checks:  node scripts/run-harness.mjs
import * as hooks from './node-loader-hook.mjs';

const nodeModule = await import('node:module');
if (nodeModule.registerHooks) {
  nodeModule.registerHooks(hooks);
} else {
  nodeModule.register('./node-loader-hook.mjs', import.meta.url);
}

await import('./outbox-harness.ts');
