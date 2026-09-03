import type { ShadowDatabase, ShadowProvider, MgcheckConfig } from '../core/types.js';
import { DockerPostgresShadow } from './docker-postgres.js';
import { PGliteShadow } from './pglite.js';

/**
 * Create a shadow database instance based on the config.
 */
export function createShadowDatabase(config: MgcheckConfig): ShadowDatabase {
  // If a direct DB URL is provided, use Docker provider with the URL
  if (config.shadowDb.dbUrl) {
    return new DockerPostgresShadow(config.shadowDb.dockerImage, config.shadowDb.dbUrl);
  }

  switch (config.shadowDb.provider) {
    case 'docker':
      return new DockerPostgresShadow(config.shadowDb.dockerImage);
    case 'pglite':
      return new PGliteShadow();
    default:
      throw new Error(`Unknown shadow DB provider: ${config.shadowDb.provider}`);
  }
}

export { DockerPostgresShadow } from './docker-postgres.js';
export { PGliteShadow } from './pglite.js';
