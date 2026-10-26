#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { readDesktopAssistanceRuntimeHandoff } from './lib/desktop-assistance-runtime-handoff.mjs';
import { R2Client } from './lib/r2-client.mjs';
import { publishAssistanceRuntimeBundles, whisperArchiveIdentityLine } from './publish-assistance-runtime-assets.mjs';

interface PublicationDependencies {
	readonly readHandoff?: typeof readDesktopAssistanceRuntimeHandoff;
	readonly publish?: typeof publishAssistanceRuntimeBundles;
	readonly createClient?: () => unknown;
}

function required(environment: NodeJS.ProcessEnv, key: string): string {
	const value = environment[key];
	if (!value?.trim()) throw new Error(`${key} is required.`);
	return value;
}

/** Publish transferred archives only after their complete local handoff passes verification. */
export async function publishDesktopAssistanceRuntimeHandoff(
	environment: NodeJS.ProcessEnv = process.env,
	{ readHandoff = readDesktopAssistanceRuntimeHandoff, publish = publishAssistanceRuntimeBundles,
		createClient = () => new R2Client({ environmentPrefix: 'R2_MODELS',
			defaultBucket: 'soundscaper-assets', label: 'assistance runtime publisher' }) }: PublicationDependencies = {},
) {
	const handoffRoot = resolve(required(environment, 'SOUNDSCAPER_ASSISTANCE_RUNTIME_HANDOFF_ROOT'));
	const archivesRoot = resolve(required(environment, 'SOUNDSCAPER_ASSISTANCE_RUNTIME_ARCHIVES_ROOT'));
	const sourceRevision = required(environment, 'SOUNDSCAPER_SOURCE_REVISION');
	const platform = required(environment, 'SOUNDSCAPER_DESKTOP_TARGET_PLATFORM');
	const architecture = required(environment, 'SOUNDSCAPER_DESKTOP_TARGET_ARCH');
	if (handoffRoot === archivesRoot) throw new Error('AI runtime handoff and archive roots must be distinct.');
	if (!/^[a-f\d]{40}(?:[a-f\d]{24})?$/u.test(sourceRevision)) {
		throw new Error('AI runtime publication requires an exact source revision.');
	}
	const targetId = `${platform}-${architecture}`;
	if (!['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64'].includes(targetId)) {
		throw new Error('AI runtime publication requires a maintained desktop target.');
	}
	const verified = await readHandoff({ handoffRoot, archivesRoot, sourceRevision, targetId,
		download: false, sourceNativeManifest: undefined });
	const whisperIdentity = whisperArchiveIdentityLine(verified.distribution);
	const result = await publish({ authority: verified.authority, archivesRoot, client: createClient() });
	return { ...result, whisperIdentity };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	if (process.argv.length !== 2) throw new Error('AI runtime handoff publication accepts environment inputs only.');
	const result = await publishDesktopAssistanceRuntimeHandoff();
	if (result.whisperIdentity) process.stdout.write(`${result.whisperIdentity}\n`);
	process.stdout.write(`Published and publicly verified ${result.published} assistance archives for ${result.targetId}.\n`);
}
