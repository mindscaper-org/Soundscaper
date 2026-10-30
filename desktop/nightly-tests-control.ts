/* SPDX-License-Identifier: AGPL-3.0-only */

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { runDesktopNightlyTestsPlaywrightChild } from '../scripts/lib/desktop-nightly-tests-playwright-child.mjs';
import type { DesktopNightlyTestsItemProgress, DesktopNightlyTestsPlaywrightPlan } from '../scripts/lib/desktop-nightly-tests-runtime.mjs';
import type { NightlyCheckpoint } from './nightly-tests-checkpoint-reporter.ts';
import { retainNightlyTestsBlob } from './nightly-tests-pause-reports.ts';

export type NightlyTestsControlState = 'running' | 'pausing' | 'paused';

export function createNightlyTestsControl({ onState = (_state: NightlyTestsControlState): void => undefined } = {}) {
	let state: NightlyTestsControlState = 'running';
	let active: AbortController | null = null;
	let resume: (() => void) | null = null;
	const change = (next: NightlyTestsControlState): void => {
		if (state === next) return;
		state = next; onState(next);
	};
	const wait = async (): Promise<void> => {
		if (state === 'running') return;
		await new Promise<void>((resolve) => { resume = resolve; change('paused'); });
	};
	return Object.freeze({
		get state() { return state; },
		pause(): void {
			if (state !== 'running') return;
			change(active ? 'pausing' : 'paused');
			active?.abort();
		},
		resume(): void {
			if (state !== 'paused') return;
			change('running');
			resume?.();
			resume = null;
		},
		async runPlaywright(plan: DesktopNightlyTestsPlaywrightPlan, onItems?: (items: DesktopNightlyTestsItemProgress) => void) {
			const root = `${plan.logFile}.attempts`;
			const reports = join(root, 'reports');
			await mkdir(reports, { recursive: true });
			await writeFile(plan.logFile, '');
			const completed = new Map<string, string>();
			let total = 0, failed = false;
			for (let attempt = 0; ; attempt += 1) {
				await wait();
				const attemptRoot = join(root, String(attempt));
				await mkdir(attemptRoot);
				const checkpointFile = join(attemptRoot, 'checkpoint.json');
				const blob = join(attemptRoot, 'report.zip');
				const skip = join(attemptRoot, 'completed.txt');
				await writeFile(skip, [...completed.values()].join('\n'));
				await wait();
				const abort = new AbortController();
				active = abort;
				let result;
				try {
					result = await runDesktopNightlyTestsPlaywrightChild({
						...plan,
						args: [...plan.args, '--reporter', `list,${join(plan.cwd, 'scripts/lib/desktop-nightly-tests-progress-reporter.mjs')},blob,${join(plan.cwd, 'desktop/nightly-tests-checkpoint-reporter.ts')}`,
							'--output', join(dirname(plan.logFile), 'test-results', String(attempt)),
							...(completed.size ? ['--test-list-invert', skip] : [])],
						env: { ...plan.env, SOUNDSCAPER_NIGHTLY_CHECKPOINT: checkpointFile, PLAYWRIGHT_BLOB_OUTPUT_FILE: blob },
						logFile: join(attemptRoot, 'console.log'),
					}, (items) => {
						total = Math.max(total, completed.size + items.total);
						onItems?.({ ...items, completed: completed.size + items.completed, total });
					}, { signal: abort.signal });
				} finally { active = null; }
				const checkpoint = await readFile(checkpointFile, 'utf8').then((text) => JSON.parse(text) as NightlyCheckpoint, () => null);
				if (checkpoint) {
					const retained = checkpoint.tests.filter((test) => test.complete);
					failed ||= retained.some((test) => test.failed);
					await retainNightlyTestsBlob({ source: blob, destination: join(reports, `${String(attempt).padStart(6, '0')}.zip`),
						consoleLog: plan.logFile,
						completed: new Set(retained.map((test) => test.id)),
						status: abort.signal.aborted ? failed ? 'failed' : 'passed' : checkpoint.status, payloadRoot: plan.cwd });
					for (const test of retained) completed.set(test.id, test.description);
				} else if (!abort.signal.aborted) {
					await copyFile(join(attemptRoot, 'console.log'), plan.logFile);
					return result;
				}
				await wait();
				if (abort.signal.aborted && (!checkpoint || completed.size < total
					|| checkpoint.tests.some((test) => !test.complete)
					|| checkpoint.status === 'interrupted' && checkpoint.tests.length === 0)) continue;
				const configIndex = plan.args.indexOf('--config');
				const merged = await runDesktopNightlyTestsPlaywrightChild({
					...plan, args: [plan.args[0]!, 'merge-reports', '--config', plan.args[configIndex + 1]!, reports],
					logFile: join(root, 'merge.log'),
				});
				if (merged.code !== 0 || merged.signal) throw new Error(`Nightly test report merge failed. See ${join(root, 'merge.log')}`);
				return abort.signal.aborted || result.code === 0 || result.code === 1
					? { code: failed || result.code === 1 && !abort.signal.aborted ? 1 : 0, signal: null } : result;
			}
		},
	});
}
