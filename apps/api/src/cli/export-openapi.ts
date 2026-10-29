import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createLeaf } from '@bookleaf/ai';
import { createDatabase } from '@bookleaf/db';
import { convert } from 'openapi-to-postmanv2';
import { pino } from 'pino';
import { buildApp } from '../app';
import { loadConfig } from '../config/env';
import { createContainer } from '../container';
import { MemoryJobQueue } from '../jobs/queue';

/**
 * pnpm docs:openapi — writes docs/api/openapi.json and a Postman collection generated from it.
 * Builds the real app against a throwaway in-memory database, so the spec is exactly what runs.
 */
const outDir = fileURLToPath(new URL('../../../../docs/api/', import.meta.url));
const config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'pglite://memory',
  PUBLIC_API_URL: process.env.PUBLIC_API_URL ?? 'http://localhost:4000',
  LOG_LEVEL: 'silent',
});
const logger = pino({ level: 'silent' });
const container = await createContainer(config, logger, {
  handle: await createDatabase({ url: 'pglite://memory' }),
  queue: new MemoryJobQueue(),
  leaf: createLeaf({}),
});
const app = await buildApp(container);
await app.ready();
const spec = app.swagger();
await mkdir(outDir, { recursive: true });
await writeFile(`${outDir}openapi.json`, `${JSON.stringify(spec, null, 2)}\n`);

const collection = await new Promise<unknown>((resolve, reject) => {
  convert(
    { type: 'json', data: JSON.stringify(spec) },
    { folderStrategy: 'Tags', requestParametersResolution: 'Example', includeAuthInfoInExample: false },
    (error, result) => {
      if (error) return reject(error);
      if (!result?.result || !result.output?.[0])
        return reject(new Error(result?.reason ?? 'conversion failed'));
      resolve(result.output[0].data);
    },
  );
});
await writeFile(`${outDir}bookleaf.postman_collection.json`, `${JSON.stringify(collection, null, 2)}\n`);

await app.close();
await container.stop();
console.log(`OpenAPI spec and Postman collection written to ${outDir}`);
