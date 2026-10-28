// Render the player report to tmp/ for visual checking: node scripts/dump-report.mjs
import * as hooks from './node-loader-hook.mjs';

const nodeModule = await import('node:module');
if (nodeModule.registerHooks) {
  nodeModule.registerHooks(hooks);
} else {
  nodeModule.register('./node-loader-hook.mjs', import.meta.url);
}

await import('./dump-report-pdf.ts');
