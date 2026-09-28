// Marks dist/cjs as CommonJS so Node does not treat it as ESM.
import { writeFileSync } from 'node:fs';

writeFileSync(new URL('../dist/cjs/package.json', import.meta.url), '{ "type": "commonjs" }\n');
writeFileSync(new URL('../dist/esm/package.json', import.meta.url), '{ "type": "module" }\n');
