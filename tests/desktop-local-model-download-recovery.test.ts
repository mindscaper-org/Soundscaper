/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { downloadLocalModelArtifact } from '../desktop/local-model-download.ts';
import { FileLocalModelStore, type LocalModelArtifact } from '../desktop/local-model-store.ts';

const PAYLOAD = 'a model download survives an interrupted connection';
const ARTIFACT: LocalModelArtifact = {
	fileName: 'model.onnx', byteLength: Buffer.byteLength(PAYLOAD),
	sha256: createHash('sha256').update(PAYLOAD).digest('hex'),
};
const URL = 'https://models.invalid/model.onnx';
const recovery = { maxAttempts: 3, timeoutMs: 15, retryDelayMs: 0, log: () => undefined };

async function fixture(context: { after(callback: () => Promise<void>): void }): Promise<FileLocalModelStore> {
	const root = await mkdtemp(join(tmpdir(), 'scape-model-recovery-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const store = new FileLocalModelStore(root);
	await store.initialize();
	return store;
}

test('a model request recovers from a temporary network refusal', async context => {
	const store = await fixture(context);
	let attempts = 0;
	const messages: string[] = [];
	await downloadLocalModelArtifact({ store, artifact: ARTIFACT, url: URL,
		recovery: { ...recovery, log: message => messages.push(message) },
		fetchImpl: async () => {
			if (++attempts === 1) throw new TypeError('fetch failed');
			return new Response(PAYLOAD);
		},
	});
	assert.equal(attempts, 2);
	assert.equal(String(await readFile(store.blobPath(ARTIFACT.sha256))), PAYLOAD);
	assert.ok(messages.some(message => /retry/iu.test(message)));
	assert.ok(messages.some(message => /recover/iu.test(message)));
	assert.ok(messages.every(message => !message.includes('models.invalid')));
});

test('an interrupted model body resumes its exact durable prefix automatically', async context => {
	const store = await fixture(context);
	const ranges: Array<string | null> = [];
	const progress: number[] = [];
	const result = await downloadLocalModelArtifact({ store, artifact: ARTIFACT, url: URL, recovery,
		onProgress: value => progress.push(value.completedBytes),
		fetchImpl: async (_url, init) => {
			ranges.push(new Headers(init?.headers).get('range'));
			if (ranges.length === 1) return {
				status: 200, headers: new Headers(),
				body: (async function* () {
					yield Buffer.from(PAYLOAD.slice(0, 10));
					throw new TypeError('connection reset');
				})(),
			} as unknown as Response;
			return new Response(PAYLOAD.slice(10), { status: 206 });
		},
	});
	assert.deepEqual(ranges, [null, 'bytes=10-']);
	assert.equal(result.transferredBytes, ARTIFACT.byteLength);
	assert.deepEqual(progress, [10, ARTIFACT.byteLength]);
	assert.equal(String(await readFile(result.blobPath)), PAYLOAD);
});

test('a stalled model fetch is bounded even when it ignores abort and its late body is cancelled', async context => {
	const store = await fixture(context);
	let late!: (response: Response) => void;
	let firstSignal: AbortSignal | undefined;
	let attempts = 0;
	let cancelled = false;
	await downloadLocalModelArtifact({ store, artifact: ARTIFACT, url: URL, recovery,
		fetchImpl: (_url, init) => {
			if (++attempts === 1) {
				firstSignal = init?.signal ?? undefined;
				return new Promise<Response>(resolve => { late = resolve; });
			}
			return Promise.resolve(new Response(PAYLOAD));
		},
	});
	assert.equal(firstSignal?.aborted, true);
	late(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(cancelled, true);
	assert.equal(attempts, 2);
});

test('a stalled model body resumes without waiting for an uncooperative iterator to close', async context => {
	const store = await fixture(context);
	let attempts = 0;
	let rejectLate!: (error: Error) => void;
	const ranges: Array<string | null> = [];
	await downloadLocalModelArtifact({ store, artifact: ARTIFACT, url: URL, recovery,
		fetchImpl: async (_url, init) => {
			ranges.push(new Headers(init?.headers).get('range'));
			if (++attempts > 1) return new Response(PAYLOAD.slice(10), { status: 206 });
			let reads = 0;
			return { status: 200, headers: new Headers(), body: {
				[Symbol.asyncIterator]() { return {
					next: () => ++reads === 1
						? Promise.resolve({ done: false, value: Buffer.from(PAYLOAD.slice(0, 10)) })
						: new Promise<IteratorResult<Uint8Array>>( (_resolve, reject) => { rejectLate = reject; }),
					return: () => new Promise<IteratorResult<Uint8Array>>(() => undefined),
				}; },
			} } as unknown as Response;
		},
	});
	assert.deepEqual(ranges, [null, 'bytes=10-']);
	rejectLate(new Error('late read rejection'));
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(String(await readFile(store.blobPath(ARTIFACT.sha256))), PAYLOAD);
});

test('caller cancellation promptly ends a stalled model request without retrying', async context => {
	const store = await fixture(context);
	const abort = new AbortController();
	const reason = new Error('installation cancelled');
	let attempts = 0;
	const download = downloadLocalModelArtifact({ store, artifact: ARTIFACT, url: URL, recovery,
		signal: abort.signal, fetchImpl: () => {
			attempts += 1;
			queueMicrotask(() => abort.abort(reason));
			return new Promise<Response>(() => undefined);
		},
	});
	await assert.rejects(download, error => error === reason);
	assert.equal(attempts, 1);
	assert.equal(await store.hasBlob(ARTIFACT.sha256), false);
});

test('temporary model HTTP failures retry while permanent rejection and integrity failure remain terminal', async context => {
	const store = await fixture(context);
	let attempts = 0;
	await downloadLocalModelArtifact({ store, artifact: ARTIFACT, url: URL, recovery,
		fetchImpl: async () => ++attempts === 1 ? new Response(null, { status: 503 }) : new Response(PAYLOAD),
	});
	assert.equal(attempts, 2);
	for (const status of [403, 404]) {
		const refusedStore = await fixture(context);
		let refused = 0;
		await assert.rejects(downloadLocalModelArtifact({ store: refusedStore, artifact: ARTIFACT, url: URL, recovery,
			fetchImpl: async () => { refused += 1; return new Response(null, { status }); },
		}), new RegExp(`status ${status}`, 'u'));
		assert.equal(refused, 1);
	}
	const corruptStore = await fixture(context);
	let corrupt = 0;
	await assert.rejects(downloadLocalModelArtifact({ store: corruptStore, artifact: ARTIFACT, url: URL, recovery,
		fetchImpl: async () => { corrupt += 1; return new Response('x'.repeat(PAYLOAD.length)); },
	}), /digest/iu);
	assert.equal(corrupt, 1);
});

test('exhausted model recovery retains partial bytes and reports one failure', async context => {
	const store = await fixture(context);
	let attempts = 0;
	await assert.rejects(downloadLocalModelArtifact({ store, artifact: ARTIFACT, url: URL, recovery,
		fetchImpl: async () => {
			if (++attempts > 1) throw new TypeError('network unavailable');
			return new Response(PAYLOAD.slice(0, 10));
		},
	}), /network|connection/iu);
	assert.equal(attempts, recovery.maxAttempts);
	assert.equal(String(await readFile(await store.partialPath(ARTIFACT.sha256))), PAYLOAD.slice(0, 10));
	assert.equal(await store.hasBlob(ARTIFACT.sha256), false);
});

test('a connection lost after all model bytes arrived verifies the complete partial without redownloading', async context => {
	const store = await fixture(context);
	let attempts = 0;
	await downloadLocalModelArtifact({ store, artifact: ARTIFACT, url: URL, recovery,
		fetchImpl: async () => {
			attempts += 1;
			return { status: 200, headers: new Headers(), body: (async function* () {
				yield Buffer.from(PAYLOAD);
				throw new TypeError('connection closed before EOF');
			})() } as unknown as Response;
		},
	});
	assert.equal(attempts, 1);
	assert.equal(String(await readFile(store.blobPath(ARTIFACT.sha256))), PAYLOAD);
});

test('throwing recovery diagnostics cannot reject a successful model installation', async context => {
	const store = await fixture(context);
	let attempts = 0;
	await downloadLocalModelArtifact({ store, artifact: ARTIFACT, url: URL,
		recovery: { ...recovery, log: () => { throw new Error('diagnostic observer failed'); } },
		fetchImpl: async () => {
			if (++attempts === 1) throw new TypeError('fetch failed');
			return new Response(PAYLOAD);
		},
	});
	assert.equal(attempts, 2);
	assert.equal(await store.hasBlob(ARTIFACT.sha256), true);
});

test('a disk open failure retires the downloaded response without retrying the disk error', async context => {
	const store = await fixture(context);
	const staging = dirname(await store.partialPath(ARTIFACT.sha256));
	let cancelled = false;
	let attempts = 0;
	await assert.rejects(downloadLocalModelArtifact({ store, artifact: ARTIFACT, url: URL, recovery,
		fetchImpl: async () => {
			attempts += 1;
			await rm(staging, { recursive: true });
			await writeFile(staging, 'unavailable directory');
			return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
		},
	}), error => error instanceof Error && 'code' in error && error.code === 'ENOTDIR');
	assert.equal(cancelled, true);
	assert.equal(attempts, 1);
	assert.equal(await store.hasBlob(ARTIFACT.sha256), false);
});
