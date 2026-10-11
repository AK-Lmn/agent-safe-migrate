import { vi } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import os, { tmpdir } from 'node:os';

/**
 * Point every home/app-data location at a throwaway directory so installer
 * tests never touch the developer's real editor configs (~/.cursor, ~/.claude.json, …).
 *
 * os.homedir() is stubbed directly: vitest runs tests in worker threads, where
 * process.env is a thread-local copy that libuv's home lookup never sees.
 */
const sandbox = mkdtempSync(join(tmpdir(), 'mgcheck-home-'));
const appData = join(sandbox, 'AppData', 'Roaming');
const localAppData = join(sandbox, 'AppData', 'Local');
mkdirSync(appData, { recursive: true });
mkdirSync(localAppData, { recursive: true });

vi.spyOn(os, 'homedir').mockReturnValue(sandbox);
process.env.HOME = sandbox;
process.env.USERPROFILE = sandbox;
process.env.APPDATA = appData;
process.env.LOCALAPPDATA = localAppData;
