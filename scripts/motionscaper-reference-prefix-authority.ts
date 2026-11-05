#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */
import { appendFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { MOTION_NATIVE_TARGETS } from './lib/motionscaper-native-source.ts';
import { createMotionReferencePrefixAuthority } from './lib/motionscaper-reference-prefix.ts';
import { requireMotionReferenceHost } from './lib/motionscaper-reference-target.ts';

export async function main(args = process.argv.slice(2)): Promise<void> {
	const { values } = parseArgs({ args, options: { target: { type: 'string' }, 'native-result': { type: 'string' },
		'native-work': { type: 'string' }, output: { type: 'string' }, 'github-output': { type: 'string' } } });
	const target = MOTION_NATIVE_TARGETS.find(target => target === values.target);
	if (!target || !values['native-result'] || !values['native-work'] || !values.output) throw new Error('Reference prefix authority requires its own target, native-result, native-work and output.');
	requireMotionReferenceHost(target);
	if (values['github-output'] && (!isAbsolute(values['github-output']) || resolve(values['github-output']) !== values['github-output'])) throw new Error('GitHub output must be an explicit absolute normalized file.');
	const pin = await createMotionReferencePrefixAuthority({ repositoryRoot: resolve(import.meta.dirname, '..'), target,
		nativeResult: resolve(values['native-result']), nativeWorkRoot: resolve(values['native-work']), output: resolve(values.output) });
	if (values['github-output']) await appendFile(values['github-output'], `sha256=${pin.sha256}\n`);
	process.stdout.write(`${JSON.stringify(pin)}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
