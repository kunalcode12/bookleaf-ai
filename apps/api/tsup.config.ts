import { cp } from 'node:fs/promises';
import { defineConfig } from 'tsup';

/**
 * Production bundle: the workspace packages (which ship TypeScript source) are compiled in;
 * third-party dependencies stay external and are installed normally. The SQL migrations are
 * copied next to the bundle so `dist/main.js` can migrate on start.
 */
export default defineConfig({
  entry: {
    main: 'src/main.ts',
    worker: 'src/worker.ts',
    'cli/migrate': 'src/cli/migrate.ts',
    'cli/seed': 'src/cli/seed.ts',
    'cli/reset': 'src/cli/reset.ts',
  },
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  splitting: true,
  noExternal: [/^@bookleaf\//],
  async onSuccess() {
    await cp('../../packages/db/migrations', 'dist/migrations', { recursive: true });
  },
});
