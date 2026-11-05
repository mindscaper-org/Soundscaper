#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { verifyMotionReferenceArtifact } from './lib/motionscaper-reference-artifact.ts';
import { MOTION_NATIVE_TARGETS } from './lib/motionscaper-native-source.ts';
import { requireMotionAuthoredAggregateTarget, runMotionAuthoredAggregate } from './lib/motionscaper-authored-aggregate.ts';
import { requireMotionQualificationHost } from '../desktop/motionscaper-qualification-platform.ts';
import { runMotionQualificationCommand } from '../desktop/motionscaper-qualification-command.ts';
import { MOTION_DESKTOP_QUALIFICATIONS, motionQualificationReceipts } from './lib/motionscaper-desktop-qualification-contract.ts';

export async function main(args = process.argv.slice(2)): Promise<void> {
	const names = ['target', 'native-result', 'decoder-artifact', 'motion-stage', 'motion-package', 'successor-stage', 'successor-package', 'output'] as const;
	const { values } = parseArgs({ args, options: Object.fromEntries(names.map(name => [name, { type: 'string' as const }])) });
	for (const name of names) if (typeof values[name] !== 'string' || !values[name]) throw new Error(`Qualification requires --${name}.`);
	const string = (key: typeof names[number]): string => { const value = values[key]; if (typeof value !== 'string') throw new TypeError('Expected qualification argument.'); return value; };
	const target = MOTION_NATIVE_TARGETS.find(value => value === string('target'));
	if (!target) throw new Error('Qualification requires an owned Motionscaper native target.');
	requireMotionQualificationHost(target);
	requireMotionAuthoredAggregateTarget(target);
	const root = resolve(import.meta.dirname, '..'), nativeResult = resolve(string('native-result')), artifact = resolve(string('decoder-artifact')), output = resolve(string('output'));
	const execute = promisify(execFile);
	const source = async () => {
		const revision = (await execute('git', ['rev-parse', 'HEAD'], { cwd: root, timeout: 10000 })).stdout.trim();
		const status = (await execute('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root, timeout: 10000 })).stdout.trim();
		if (!/^[a-f0-9]{40}$/u.test(revision) || status) throw new Error('Qualification requires a clean source checkout and an ignored or external output directory.');
		return revision;
	};
	const revision = await source();
	await verifyMotionReferenceArtifact({ repositoryRoot: root, nativeResult, artifact, target });
	await mkdir(output, { recursive: false });
	const env = { ...process.env, MOTIONSCAPER_REFERENCE_ARTIFACT: artifact, MOTIONSCAPER_REFERENCE_NATIVE_RESULT: nativeResult,
		MOTIONSCAPER_QUALIFICATION_STAGE: resolve(string('motion-stage')), MOTIONSCAPER_QUALIFICATION_PACKAGE: resolve(string('motion-package')),
		FRAMESCAPER_SUCCESSOR_QUALIFICATION_STAGE: resolve(string('successor-stage')), FRAMESCAPER_SUCCESSOR_QUALIFICATION_PACKAGE: resolve(string('successor-package')) };
	const receipts: Readonly<Record<string, unknown>>[] = [], logs = [];
	for (const phase of MOTION_DESKTOP_QUALIFICATIONS) {
		let stdout: string, stderr: string;
		try {
			if (phase.id === 'authored') ({ stdout, stderr } = await runMotionAuthoredAggregate(root, output, env, undefined, { target }));
			else if (process.platform === 'linux') {
				// Preserve the existing Linux phase command and output/deadline bounds.
				({ stdout, stderr } = await execute(process.execPath, [join(root, 'scripts', phase.script)], { cwd: root, env, timeout: 360000, maxBuffer: 2 * 1024 * 1024 }));
			} else {
				const directory = join(output, `${phase.id}-command`); await mkdir(directory, { mode: 0o700 });
				({ stdout, stderr } = await runMotionQualificationCommand({ command: process.execPath, args: [join(root, 'scripts', phase.script)],
					cwd: root, env, directory, id: phase.id, timeoutMs: 360000, maximumOutputBytes: 2 * 1024 * 1024 }));
			}
		}
		catch (error) {
			const diagnostics = [String(error), ...['stdout', 'stderr'].map(key => error && typeof error === 'object' && typeof Reflect.get(error, key) === 'string' ? String(Reflect.get(error, key)) : '')].join('\n').slice(0, 4 * 1024 * 1024);
			await writeFile(join(output, `${phase.id}-failed.txt`), diagnostics, { flag: 'wx' }); throw error;
		}
		if (await source() !== revision) throw new Error('Qualification source changed during its owned phase.');
		const log = `${stdout}\n${stderr}`; await writeFile(join(output, `${phase.id}.txt`), log, { flag: 'wx' });
		receipts.push(...motionQualificationReceipts(stdout, phase.markers, revision)); logs.push({ path: `${phase.id}.txt`, sha256: sha(log) });
		process.stdout.write(stdout);
	}
	const pins = [];
	for (const [id, path] of [['motion-stage', join(env.MOTIONSCAPER_QUALIFICATION_STAGE, 'stage-manifest.json')], ['successor-stage', join(env.FRAMESCAPER_SUCCESSOR_QUALIFICATION_STAGE, 'stage-manifest.json')],
		['native-result', join(nativeResult, 'build-result.json')], ['reference-decoder', join(artifact, 'reference-receipt.json')]] as const) {
		const bytes = await readFile(path); await writeFile(join(output, `${id}.json`), bytes, { flag: 'wx' }); pins.push({ path: `${id}.json`, sha256: sha(bytes) });
	}
	await writeFile(join(output, 'qualification.json'), `${JSON.stringify({ schemaVersion: 1, productId: 'motionscaper', target, sourceRevision: revision, receipts, logs, pins }, null, '\t')}\n`, { flag: 'wx' });
}
function sha(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
