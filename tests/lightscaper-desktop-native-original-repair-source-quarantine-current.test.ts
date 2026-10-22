/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import type { LightscaperOriginalRepairWorkerInputCurrentV1 as WorkerInput } from './helpers/lightscaper-native-original-repair-source-quarantine-worker-current.ts';
void test('Lightscaper actual upload close failure prevents repair publication and retains real namespace quarantine',
	{ timeout: 15_000, concurrency: false }, async context => {
		const appDataPath = await mkdtemp(join(tmpdir(), 'lightscaper-repair-source-quarantine-'));
		let worker: Worker | undefined, exited = false, terminating: Promise<number> | undefined, received: unknown, failure: unknown, expired = false;
		const stop = (): void => { if (worker && !exited) { terminating ??= worker.terminate(); void terminating.catch(() => undefined); } };
		context.signal.addEventListener('abort', stop, { once: true });
		const deadline = setTimeout(() => { expired = true; stop(); }, 12_000);
		try {
			worker = new Worker(new URL('./helpers/lightscaper-native-original-repair-source-quarantine-worker-current.ts', import.meta.url), {
				execArgv: ['--import', import.meta.resolve('tsx')], resourceLimits: { maxOldGenerationSizeMb: 96 }, workerData: { appDataPath } satisfies WorkerInput,
			});
			const actual = worker, exit = new Promise<number>(resolve => {
				actual.on('message', (value: unknown) => { received = value; }); actual.on('error', (error: unknown) => { failure = error; });
				actual.once('exit', code => { exited = true; resolve(code); });
			});
			if (context.signal.aborted) stop(); const result = await exit;
			if (failure !== undefined) throw failure; assert.equal(expired, false); assert.equal(result, 0);
			assert.deepEqual(received, { refused: true, actualClose: true, busy: true, reflected: 0, closeRefused: true, heads: 0 });
		} finally {
			clearTimeout(deadline); context.signal.removeEventListener('abort', stop);
			if (worker && !exited) { terminating ??= worker.terminate(); await terminating; } else if (terminating) await terminating;
			await rm(appDataPath, { recursive: true, force: true });
		}
	});
