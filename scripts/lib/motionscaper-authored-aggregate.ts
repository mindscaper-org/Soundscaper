/* SPDX-License-Identifier: AGPL-3.0-only */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { motionQualificationTarget } from '../../desktop/motionscaper-qualification-platform.ts';
import { runMotionQualificationCommand } from '../../desktop/motionscaper-qualification-command.ts';
import type { motionSustainedCommand } from '../performance/motionscaper-sustained-command.ts';
import { MOTION_NATIVE_TARGETS, type MotionNativeTarget } from './motionscaper-native-source.ts';

/** Complete aggregate qualification must not silently omit the authored workflow. */
export function requireMotionAuthoredAggregateTarget(target: string): void {
	if (!(MOTION_NATIVE_TARGETS as readonly string[]).includes(target)) throw new Error(`Unsupported complete Motion qualification target ${target}.`);
}

/** The aggregate caller owns Xvfb. Runtime overrides apply only to this child;
 * scene qualification keeps its original /tmp path authority and environment. */
export async function runMotionAuthoredAggregate(root: string, output: string, environment: NodeJS.ProcessEnv,
	execute: typeof motionSustainedCommand = runMotionQualificationCommand, options: Readonly<{ target?: MotionNativeTarget }> = {}) {
	const target = options.target ?? motionQualificationTarget(); requireMotionAuthoredAggregateTarget(target);
	const linux = target.startsWith('linux-');
	if (linux && !/^:\d+$/u.test(environment.DISPLAY ?? '')) throw new Error('Authored aggregate requires its owned X11 display.');
	const directory = join(output, 'authored-command'); await mkdir(directory, { mode: 0o700 });
	const runtime = await mkdtemp(linux ? '/tmp/motionscaper-authored-aggregate-' : join(tmpdir(), 'motionscaper-authored-aggregate-'));
	await writeFile(join(directory, 'runtime.json'), `${JSON.stringify({ directory: runtime,
		failurePolicy: 'Runtime is retained on failure for inspection; never remove paths while child cleanup is uncertain.' }, null, 2)}\n`, { flag: 'wx' });
	const temporary = join(runtime, 'tmp'), xdg = join(runtime, 'xdg');
	await mkdir(temporary, { mode: 0o700 }); await mkdir(xdg, { mode: 0o700 });
	const result = await execute({ command: process.execPath,
		args: [join(root, 'scripts/motionscaper-authored-native-smoke.mjs'), `--output=${join(output, 'authored')}`],
		cwd: root, directory, id: 'authored', timeoutMs: 210000,
		env: linux ? { ...environment, TMPDIR: temporary, XDG_RUNTIME_DIR: xdg, MOTIONSCAPER_QUALIFICATION_PRIVATE_DISPLAY: environment.DISPLAY } : { ...environment },
	});
	// The maintained owner returns only after successful child/descendant cleanup.
	await rm(runtime, { recursive: true });
	return result;
}
