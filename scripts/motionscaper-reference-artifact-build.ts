#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { buildLegacyLinuxMotionReferenceDecoder } from '../desktop/motionscaper-native-reference.ts';
import { createMotionReferenceArtifact } from './lib/motionscaper-reference-artifact.ts';
import { MOTION_NATIVE_TARGETS } from './lib/motionscaper-native-source.ts';
import { buildAuditedMotionReferenceDecoder } from './lib/motionscaper-reference-build.ts';
import { requireMotionReferenceHost } from './lib/motionscaper-reference-target.ts';

export async function main(args = process.argv.slice(2)): Promise<void> {
	const { values } = parseArgs({ args, options: { target: { type: 'string' }, 'native-result': { type: 'string' }, 'ffmpeg-prefix': { type: 'string' }, output: { type: 'string' },
		'prefix-authority': { type: 'string' }, 'prefix-authority-sha256': { type: 'string' } } });
	const target = MOTION_NATIVE_TARGETS.find(target => target === values.target);
	if (!target || !values['native-result'] || !values['ffmpeg-prefix'] || !values.output) throw new Error('Reference build requires a supported native --target, --native-result, --ffmpeg-prefix and --output.');
	requireMotionReferenceHost(target);
	const authority = values['prefix-authority'], digest = values['prefix-authority-sha256'];
	if (Boolean(authority) !== Boolean(digest) || (digest !== undefined && !/^[a-f\d]{64}$/u.test(digest))) throw new Error('Reference prefix authority and its independent expected SHA256 must be supplied together.');
	if (!authority && !target.startsWith('linux-')) throw new Error('Non-Linux reference builds require an independent prefix authority.');
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'motion-reference-build-')));
	try {
		const common = { repositoryRoot: resolve(import.meta.dirname, '..'), nativeResult: resolve(values['native-result']), target };
		const result = authority && digest ? await buildAuditedMotionReferenceDecoder({ ...common, directory, prefix: resolve(values['ffmpeg-prefix']),
			prefixAuthority: resolve(authority), prefixAuthoritySha256: digest }) : { executable: await buildLegacyLinuxMotionReferenceDecoder(directory, resolve(values['ffmpeg-prefix'])) };
		await createMotionReferenceArtifact({ ...common, decoder: result.executable, output: resolve(values.output), ...('build' in result ? { build: result.build } : {}) });
	} finally { await rm(directory, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
