#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';

import { configureCiArtifactFetch } from './lib/ci-artifact-fetch.ts';
import { buildDesktopAssistanceEnginePart } from './lib/desktop-assistance-engine-parts.ts';

configureCiArtifactFetch();
const familyId = process.env.SOUNDSCAPER_ASSISTANCE_ENGINE_FAMILY ?? '';
const repositoryRoot = resolve(import.meta.dirname, '..');
await buildDesktopAssistanceEnginePart({
	familyId,
	targetId: `${process.env.SOUNDSCAPER_DESKTOP_TARGET_PLATFORM}-${process.env.SOUNDSCAPER_DESKTOP_TARGET_ARCH}`,
	sourceRevision: process.env.SOUNDSCAPER_SOURCE_REVISION,
	partRoot: resolve(repositoryRoot, '.native-build/assistance-engine-parts', familyId),
	cacheRoot: resolve(repositoryRoot, '.native-build/assistance-runtimes'),
});
console.log(`Prepared authenticated ${familyId} Windows ARM engine part.`);
