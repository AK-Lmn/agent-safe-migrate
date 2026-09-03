import Dockerode from 'dockerode';
import pg from 'pg';
import type { ShadowDatabase, ConnectionConfig, ExecutionResult } from '../core/types.js';

const { Client } = pg;

/**
 * Docker-based shadow database using official Postgres image.
 *
 * Lifecycle:
 * 1. Pull image (if not cached)
 * 2. Start container with random port
 * 3. Wait for Postgres to accept connections
 * 4. Execute migrations
 * 5. Force-remove container
 */
export class DockerPostgresShadow implements ShadowDatabase {
  private docker: Dockerode;
  private container: Dockerode.Container | null = null;
  private connectionConfig: ConnectionConfig | null = null;
  private externalDbUrl: string | null = null;
  private imageName: string;

  constructor(imageName: string = 'postgres:16-alpine', externalDbUrl?: string) {
    this.docker = new Dockerode();
    this.imageName = imageName;
    this.externalDbUrl = externalDbUrl || null;
  }

  async create(): Promise<ConnectionConfig> {
    // If using an external database URL, parse it and return
    if (this.externalDbUrl) {
      const url = new URL(this.externalDbUrl);
      this.connectionConfig = {
        host: url.hostname,
        port: parseInt(url.port || '5432', 10),
        database: url.pathname.slice(1) || 'postgres',
        user: url.username || 'postgres',
        password: url.password || 'postgres',
      };
      return this.connectionConfig;
    }

    // Pull image if needed
    try {
      await this.docker.getImage(this.imageName).inspect();
    } catch {
      console.error(`Pulling ${this.imageName}...`);
      await new Promise<void>((resolve, reject) => {
        this.docker.pull(this.imageName, (err: any, stream: any) => {
          if (err) return reject(err);
          this.docker.modem.followProgress(stream, (err2: any) => {
            if (err2) return reject(err2);
            resolve();
          });
        });
      });
    }

    const password = 'mgcheck_shadow_' + Math.random().toString(36).substring(7);
    const containerName = `mgcheck-shadow-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // Create and start container
    this.container = await this.docker.createContainer({
      Image: this.imageName,
      name: containerName,
      Env: [
        `POSTGRES_PASSWORD=${password}`,
        'POSTGRES_DB=mgcheck_shadow',
        'POSTGRES_USER=mgcheck',
      ],
      HostConfig: {
        AutoRemove: true,
        PortBindings: {
          '5432/tcp': [{ HostPort: '0' }], // Random port
        },
      },
      ExposedPorts: {
        '5432/tcp': {},
      },
    });

    await this.container.start();

    // Get the assigned port
    const info = await this.container.inspect();
    const hostPort =
      info.NetworkSettings.Ports['5432/tcp']?.[0]?.HostPort;

    if (!hostPort) {
      throw new Error('Failed to get assigned port for shadow database container');
    }

    this.connectionConfig = {
      host: '127.0.0.1',
      port: parseInt(hostPort, 10),
      database: 'mgcheck_shadow',
      user: 'mgcheck',
      password,
    };

    // Wait for Postgres to be ready
    await this.waitForReady();

    return this.connectionConfig;
  }

  async seed(sql: string): Promise<void> {
    if (!this.connectionConfig) {
      throw new Error('Shadow database not created yet. Call create() first.');
    }

    const client = new Client(this.connectionConfig);
    try {
      await client.connect();
      await client.query(sql);
    } finally {
      await client.end();
    }
  }

  async execute(sql: string): Promise<ExecutionResult> {
    if (!this.connectionConfig) {
      throw new Error('Shadow database not created yet. Call create() first.');
    }

    const client = new Client(this.connectionConfig);
    const startTime = Date.now();
    let statementsExecuted = 0;

    try {
      await client.connect();

      // Execute the full migration SQL
      // pg client handles multi-statement SQL natively
      const result = await client.query(sql);
      statementsExecuted = Array.isArray(result) ? result.length : 1;

      return {
        success: true,
        executionTimeMs: Date.now() - startTime,
        statementsExecuted,
      };
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message,
        executionTimeMs: Date.now() - startTime,
        statementsExecuted,
      };
    } finally {
      await client.end();
    }
  }

  async teardown(): Promise<void> {
    if (this.container) {
      try {
        await this.container.stop({ t: 2 });
      } catch {
        // Container may already be stopped (AutoRemove)
      }
      try {
        await this.container.remove({ force: true });
      } catch {
        // Container may already be removed (AutoRemove)
      }
      this.container = null;
    }
    this.connectionConfig = null;
  }

  /**
   * Wait for Postgres to accept connections with exponential backoff.
   * Timeout: 30 seconds.
   */
  private async waitForReady(timeoutMs: number = 30000): Promise<void> {
    if (!this.connectionConfig) throw new Error('No connection config');

    const startTime = Date.now();
    let delay = 200; // Start with 200ms

    while (Date.now() - startTime < timeoutMs) {
      const client = new Client(this.connectionConfig);
      try {
        await client.connect();
        await client.query('SELECT 1');
        await client.end();
        return; // Ready!
      } catch {
        await client.end().catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * 1.5, 2000); // Cap at 2s
      }
    }

    throw new Error(
      `Shadow database failed to become ready within ${timeoutMs / 1000}s. ` +
        'Ensure Docker is running and the Postgres image is accessible.'
    );
  }
}
