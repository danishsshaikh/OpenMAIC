import { rollup } from 'rollup';
import config from '../rollup.config.js';

async function build() {
  const configs = Array.isArray(config) ? config : [config];

  for (const options of configs) {
    const bundle = await rollup(options);
    const outputs = Array.isArray(options.output) ? options.output : [options.output];

    try {
      for (const output of outputs) {
        await bundle.write(output);
      }
    } finally {
      await bundle.close();
    }
  }
}

try {
  await build();
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
