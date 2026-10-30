#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';

import { configureCiArtifactFetch } from './lib/ci-artifact-fetch.ts';
import { prepareDesktopAssistanceOnly } from './lib/desktop-assistance-runtime-preparation.mjs';

configureCiArtifactFetch();
const targetId = `${process.env.SOUNDSCAPER_DESKTOP_TARGET_PLATFORM}-${process.env.SOUNDSCAPER_DESKTOP_TARGET_ARCH}`;
await prepareDesktopAssistanceOnly({ repositoryRoot: resolve(import.meta.dirname, '..'), targetId,
	sourceRevision: process.env.SOUNDSCAPER_SOURCE_REVISION });
console.log(`Prepared authenticated AI runtimes for ${targetId}.`);
