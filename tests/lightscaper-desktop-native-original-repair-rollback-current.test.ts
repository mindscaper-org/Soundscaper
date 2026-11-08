/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1 as paths } from '../desktop/lightscaper-native-original-index-current-v1.ts';
import type { NativeOriginalRepairRollbackReportCurrentV1 } from './helpers/lightscaper-native-original-repair-rollback-worker-current.ts';

for (const mode of ['refused-commit', 'lost-ack'] as const) void test(mode === 'refused-commit'
	? 'Lightscaper native repair quarantines real denied COMMIT+ROLLBACK before borrower reflection and joins actual DB close'
	: 'Lightscaper native repair retains opaque lost ACK plus genuine reconciliation-read and rollback failures through quarantine',
	{ concurrency: false, timeout: 15_000 }, async context => {
		const appDataPath = await mkdtemp(join(tmpdir(), 'lightscaper-original-repair-rollback-'));
		let worker: Worker | undefined, received: unknown, workerFailure: unknown, exited = false, terminating: Promise<number> | undefined;
		const abort = (): void => {
			if (worker && !exited) { terminating ??= worker.terminate(); void terminating.catch(() => undefined); }
		};
		context.signal.addEventListener('abort', abort, { once: true });
		try {
			worker = new Worker(new URL('./helpers/lightscaper-native-original-repair-rollback-worker-current.ts', import.meta.url), {
				execArgv: ['--import', import.meta.resolve('tsx')], resourceLimits: { maxOldGenerationSizeMb: 96 }, workerData: { appDataPath, mode },
			});
			const current = worker;
			const exit = new Promise<number>(resolve => {
				current.on('message', (message: unknown) => { received = message; });
				current.on('error', (error: unknown) => { workerFailure = error; });
				current.once('exit', code => { exited = true; resolve(code); });
			});
			if (context.signal.aborted) abort();
			const code = await exit;
			if (workerFailure !== undefined) throw workerFailure;
			assert.equal(code, 0, JSON.stringify(received));
			const expected: NativeOriginalRepairRollbackReportCurrentV1 = { commitDenied: mode === 'refused-commit', rollbackDenied: true, transactionRetained: true,
				repairRejected: true, secondRepairBusy: true, borrowedReflections: 0, closeRejected: true, actualPrivateCloseAttempted: true,
				...(mode === 'lost-ack' ? { commitCompleted: true, reconciliationReadDenied: true, originalPrimaryPreserved: true,
					readFailurePreserved: true, rollbackFailurePreserved: true } : {}) };
			assert.deepEqual(received, expected);
			// Worker exit and actual native close precede independent read-only
			// evidence: the refused COMMIT rolled back; lost ACK preserves its
			// genuine committed head despite the later failed read transaction.
			const reader = new DatabaseSync(paths(appDataPath).databasePath, { readOnly: true });
			try {
				assert.equal(reader.prepare('SELECT count(*) AS n FROM native_photo_original_body_heads').get()?.n, mode === 'lost-ack' ? 1 : 0);
				assert.equal(reader.prepare('SELECT count(*) AS n FROM native_photo_media_assets').get()?.n, 1);
				assert.equal(reader.prepare('SELECT root_count FROM native_photo_media_assets').get()?.root_count, 1);
				assert.equal(reader.prepare('SELECT count(*) AS n FROM native_photo_media_roots').get()?.n, 1);
			} finally { reader.close(); }
		} finally {
			context.signal.removeEventListener('abort', abort);
			if (worker && !exited) { terminating ??= worker.terminate(); await terminating; }
			else if (terminating) await terminating;
			await rm(appDataPath, { recursive: true, force: true });
		}
	});
