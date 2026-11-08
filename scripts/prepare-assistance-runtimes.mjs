#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';

import { configureCiArtifactFetch } from './lib/ci-artifact-fetch.ts';
import { prepareDesktopAssistanceOnly } from './lib/desktop-assistance-runtime-preparation.mjs';

configureCiArtifactFetch();
const targetId = `${process.env.SOUNDSCAPER_DESKTOP_TARGET_PLATFORM}-${process.env.SOUNDSCAPER_DESKTOP_TARGET_ARCH}`;
await prepareDesktopAssistanceOnly({ repositoryRoot: resolve(import.meta.dirname, '..'), targetId,
	sourceRevision: process.env.SOUNDSCAPER_SOURCE_REVISION,
	handoffRoot: process.env.SOUNDSCAPER_ASSISTANCE_RUNTIME_HANDOFF_ROOT,
	enginePartsRoot: process.env.SOUNDSCAPER_ASSISTANCE_ENGINE_PARTS_ROOT });
console.log(`Prepared authenticated AI runtimes for ${targetId}.`);
