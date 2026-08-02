#!/usr/bin/env tsx
/** Delete the local dev stack's data directory. `pnpm dev:local:reset` */
import fs from 'node:fs/promises';

import { localDataDir } from './paths';

const dir = localDataDir();
await fs.rm(dir, { recursive: true, force: true });
console.log(`Removed ${dir}`);
