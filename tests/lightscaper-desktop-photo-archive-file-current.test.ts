/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { DESKTOP_PHOTO_ARCHIVE_RANGE_BYTES_CURRENT_V1 as RANGE, materializeDesktopPhotoArchiveFileCurrentV1,
	type DesktopPhotoArchiveDirectoryCurrentV1, type DesktopPhotoArchiveFetchCurrentV1,
	type DesktopPhotoArchiveFileOptionsCurrentV1 } from '../src/lightscaper/desktop-photo-archive-file-current-v1.ts';
import type { DesktopLightscaperArchiveOpenDescriptorCurrentV1 } from '../src/common/editor/desktop-lightscaper-archive-open-contract-current-v1.ts';
import { deferred, remainsPending, waitForEvent } from './helpers/async-test-control.ts';

const ID = 'a'.repeat(64), TOKEN = '00000000-0000-4000-8000-000000000001';
function descriptor(size = 5): DesktopLightscaperArchiveOpenDescriptorCurrentV1 {
	const name = 'Library.liscape';
	return Object.freeze({ id: ID, name, size, mimeType: 'application/vnd.soundscaper.scape+zip',
		readProfile: 'scape-range-v1', lastModified: 0,
		url: `lightscaper-app://bundle/_desktop/read/scape-range-v1/${ID}/${encodeURIComponent(name)}` });
}
interface Controls {
	readonly bytes?: Uint8Array<ArrayBuffer>;
	readonly collision?: boolean;
	readonly writeGate?: ReturnType<typeof deferred<void>>;
	readonly closeGate?: ReturnType<typeof deferred<void>>;
	readonly abortGate?: ReturnType<typeof deferred<void>>;
	readonly writeFailure?: unknown;
	readonly closeFailure?: unknown;
	readonly abortFailure?: unknown;
	readonly removeFailure?: unknown;
	readonly finishFailure?: unknown;
	readonly file?: () => File;
}
function fixture(controls: Controls = {}) {
	const input = controls.bytes ?? Uint8Array.of(1, 2, 3, 4, 5), events: string[] = [], writes: Uint8Array<ArrayBuffer>[] = [];
	const requests: Readonly<{ url: string; range: string; cache: string; redirect: string; credentials: string }>[] = [];
	let selectedName = '', deleted = 0;
	const stage = {
		async getFileHandle(name: string, options: Readonly<{ create: boolean }>) {
			assert.equal(options.create, true); selectedName = name; events.push('file-open');
			return { async createWritable(options: Readonly<{ keepExistingData: false }>) {
				assert.deepEqual(options, { keepExistingData: false }); events.push('writable-open');
				return { async write(bytes: Uint8Array<ArrayBuffer>) {
					events.push('write-start'); await controls.writeGate?.promise;
					if (controls.writeFailure !== undefined) throw controls.writeFailure;
					writes.push(bytes.slice()); events.push('write-end');
				}, async close() {
					events.push('close-start'); await controls.closeGate?.promise;
					if (controls.closeFailure !== undefined) throw controls.closeFailure; events.push('close-end');
				}, async abort() {
					events.push('abort-start'); await controls.abortGate?.promise;
					if (controls.abortFailure !== undefined) throw controls.abortFailure; events.push('abort-end');
				} };
			}, async getFile() { events.push('get-file'); return controls.file ? controls.file() : new File(writes, selectedName); } };
		},
	};
	const parent = {
		async getDirectoryHandle(name: string, options: Readonly<{ create: boolean }>) {
			assert.equal(name, `incoming-${TOKEN}`); events.push(options.create ? 'stage-create' : 'stage-probe');
			if (!options.create && !controls.collision) throw new DOMException('Missing', 'NotFoundError');
			return stage;
		},
		async removeEntry(name: string, options: Readonly<{ recursive: true }>) {
			assert.equal(name, `incoming-${TOKEN}`); assert.deepEqual(options, { recursive: true }); events.push('remove-start');
			if (controls.removeFailure !== undefined) throw controls.removeFailure; deleted++; events.push('remove-end');
		},
	};
	const root = { async getDirectoryHandle(name: string, options: Readonly<{ create: boolean }>) {
		assert.equal(name, 'lightscaper-desktop-archive-staging-v1'); assert.deepEqual(options, { create: true });
		events.push('parent-open'); return parent;
	} } as unknown as DesktopPhotoArchiveDirectoryCurrentV1;
	const fetch: DesktopPhotoArchiveFetchCurrentV1 = async (url, init) => {
		const match = /^bytes=(\d+)-(\d+)$/u.exec(init.headers.Range); assert.ok(match);
		const start = Number(match[1]), end = Number(match[2]);
		assert.ok(end - start + 1 <= RANGE); events.push('fetch');
		requests.push({ url, range: init.headers.Range, cache: init.cache, redirect: init.redirect, credentials: init.credentials });
		return response(input.slice(start, end + 1), start, end, input.length);
	};
	const options: DesktopPhotoArchiveFileOptionsCurrentV1 = { createId: () => TOKEN, fetch,
		storage: { async getDirectory() { events.push('root-open'); return root; } },
		async finishArchive(request) { assert.deepEqual(request, { id: ID }); events.push('finish');
			if (controls.finishFailure !== undefined) throw controls.finishFailure; },
	};
	return { options, events, requests, writes, deleted: () => deleted };
}
function response(bytes: Uint8Array<ArrayBuffer>, start = 0, end = bytes.length - 1, size = bytes.length,
	options: Readonly<{ status?: number; headers?: Record<string, string>; stream?: ReadableStream<Uint8Array<ArrayBuffer>> }> = {}) {
	return new Response(options.stream ?? bytes, { status: options.status ?? 206,
		headers: { 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}`, ...options.headers } });
}

test('Light archive materialization streams bounded sequential ranges and returns an actual retained native File', async () => {
	const bytes = new Uint8Array(RANGE + 7); bytes.fill(17); bytes.set([1, 2, 3, 4, 5, 6, 7], RANGE);
	const gate = deferred<void>(), f = fixture({ bytes, writeGate: gate });
	const work = materializeDesktopPhotoArchiveFileCurrentV1(descriptor(bytes.length), f.options);
	try {
		await waitForEvent(f.events, 'write-start'); assert.equal(f.requests.length, 1); assert.equal(await remainsPending(work), true);
		gate.resolve(); const staged = await work;
		assert.deepEqual(f.requests.map(value => value.range), [`bytes=0-${RANGE - 1}`, `bytes=${RANGE}-${RANGE + 6}`]);
		assert.ok(f.requests.every(value => value.url === descriptor().url && value.cache === 'no-store' && value.redirect === 'error' && value.credentials === 'omit'));
		assert.equal(staged.file.name, 'Library.liscape'); assert.equal(staged.file.size, bytes.length);
		assert.equal(Reflect.apply(Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!, staged.file, []), bytes.length);
		assert.deepEqual([...new Uint8Array(await staged.file.slice(RANGE).arrayBuffer())], [1, 2, 3, 4, 5, 6, 7]);
		assert.ok(f.events.indexOf('finish') > f.events.indexOf('get-file')); assert.equal(f.deleted(), 0);
		const first = staged.close(); assert.equal(staged.close(), first); await first;
		assert.equal(f.deleted(), 1); assert.ok(f.events.indexOf('remove-start') > f.events.indexOf('finish'));
	} finally { gate.resolve(); const result = await work.catch(() => null); await result?.close(); }
});

test('Light archive pre-abort releases an already taken grant without touching OPFS or fetch', async () => {
	const f = fixture(), stop = new AbortController(), reason = Object.freeze({ opaque: 'cancel' }); stop.abort(reason);
	await assert.rejects(materializeDesktopPhotoArchiveFileCurrentV1(descriptor(), { ...f.options, signal: stop.signal }), error => Object.is(error, reason));
	assert.deepEqual(f.events, ['finish']);
});

test('Light archive admission refuses other origins, profiles and path aliases while retiring the inert issued ID', async () => {
	for (const patch of [ { url: descriptor().url.replace('lightscaper-app:', 'soundscaper-app:') },
		{ url: descriptor().url + '?anything' }, { url: descriptor().url.replace('/scape-range-v1/', '/selected-range-v1/') },
		{ url: descriptor().url.replace('/Library.liscape', '/other.liscape') }, { readProfile: 'materialized-v1' },
		{ size: 0 }, { size: Number.MAX_SAFE_INTEGER + 1 }, { name: '../Library.liscape' } ]) {
		const f = fixture();
		await assert.rejects(materializeDesktopPhotoArchiveFileCurrentV1({ ...descriptor(), ...patch }, f.options));
		assert.deepEqual(f.events, ['finish']);
	}
});

test('Light archive refuses full-body and malformed interval responses and cancels their readers before release', async () => {
	const cases: readonly Readonly<{ status?: number; headers?: Record<string, string> }>[] = [
		{ status: 200 }, { headers: { 'Content-Length': '4' } },
		{ headers: { 'Content-Range': 'bytes 0-4/6' } }, { headers: { 'Content-Range': 'bytes 1-5/5' } },
	];
	for (const patch of cases) {
		const f = fixture(); let cancelled = false;
		const body = new ReadableStream<Uint8Array<ArrayBuffer>>({ cancel() { cancelled = true; f.events.push('reader-cancel'); } });
		await assert.rejects(materializeDesktopPhotoArchiveFileCurrentV1(descriptor(), { ...f.options,
			fetch: async () => response(Uint8Array.of(), 0, 4, 5, { ...patch, stream: body }) }));
		assert.equal(cancelled, true); assert.deepEqual(f.writes, []); assert.equal(f.deleted(), 1);
		assert.ok(f.events.indexOf('finish') > f.events.indexOf('reader-cancel'));
		assert.ok(f.events.indexOf('finish') > f.events.indexOf('abort-end'));
	}
});

test('Light archive rejects short and overlong bodies instead of accepting declared Content-Length', async () => {
	for (const bytes of [Uint8Array.of(1, 2, 3, 4), Uint8Array.of(1, 2, 3, 4, 5, 6)]) {
		const f = fixture();
		await assert.rejects(materializeDesktopPhotoArchiveFileCurrentV1(descriptor(), { ...f.options,
			fetch: async () => response(bytes, 0, 4, 5) }));
		assert.equal(f.deleted(), 1); assert.equal(f.events.includes('close-start'), false); assert.equal(f.events.filter(value => value === 'finish').length, 1);
	}
});

test('Light archive cancellation joins native reader cancellation and writable abort before releasing and deleting', async () => {
	const stop = new AbortController(), reason = Symbol('cancel'), readerCancel = deferred<void>(), abort = deferred<void>();
	const f = fixture({ abortGate: abort });
	const body = new ReadableStream<Uint8Array<ArrayBuffer>>({ pull() { f.events.push('reader-pull'); },
		async cancel(value) { assert.equal(value, reason); f.events.push('reader-cancel-start'); await readerCancel.promise; f.events.push('reader-cancel-end'); } }, { highWaterMark: 0 });
	const work = materializeDesktopPhotoArchiveFileCurrentV1(descriptor(), { ...f.options, signal: stop.signal,
		fetch: async () => response(Uint8Array.of(), 0, 4, 5, { stream: body }) });
	void work.catch(() => undefined);
	try {
		await waitForEvent(f.events, 'reader-pull'); stop.abort(reason); await waitForEvent(f.events, 'reader-cancel-start');
		assert.equal(await remainsPending(work), true); assert.equal(f.events.includes('finish'), false); assert.equal(f.deleted(), 0);
		readerCancel.resolve(); await waitForEvent(f.events, 'abort-start');
		assert.equal(await remainsPending(work), true); assert.equal(f.events.includes('finish'), false); assert.equal(f.deleted(), 0);
		abort.resolve(); await assert.rejects(work, error => Object.is(error, reason));
		assert.equal(f.deleted(), 1); assert.ok(f.events.indexOf('finish') > f.events.indexOf('reader-cancel-end'));
		assert.ok(f.events.indexOf('remove-start') > f.events.indexOf('abort-end'));
	} finally { readerCancel.resolve(); abort.resolve(); await work.catch(() => undefined); }
});

test('Light archive cancellation waits a held write and never assembles a huge declared archive in memory', async () => {
	const stop = new AbortController(), gate = deferred<void>(), f = fixture({ writeGate: gate }), reason = Symbol('stop');
	const huge = descriptor(8 * 1024 ** 3), work = materializeDesktopPhotoArchiveFileCurrentV1(huge, { ...f.options, signal: stop.signal,
		fetch: async (_url, request) => { assert.equal(request.headers.Range, `bytes=0-${RANGE - 1}`);
			return response(Uint8Array.of(1), 0, RANGE - 1, huge.size); } });
	void work.catch(() => undefined);
	try {
		await waitForEvent(f.events, 'write-start'); stop.abort(reason); assert.equal(await remainsPending(work), true);
		assert.equal(f.events.includes('finish'), false); assert.equal(f.deleted(), 0);
		gate.resolve(); await assert.rejects(work, error => Object.is(error, reason));
		assert.equal(f.writes.length, 1); assert.equal(f.writes[0]!.byteLength, 1); assert.equal(f.deleted(), 1);
	} finally { gate.resolve(); await work.catch(() => undefined); }
});

test('Light archive cancellation joins a fetch that resolves late, then retires its newly arrived response', async () => {
	const f = fixture(), stop = new AbortController(), arrival = deferred<Response>(), cancelled = deferred<void>(), reason = Symbol('cancel');
	void arrival.promise.catch(() => undefined);
	const work = materializeDesktopPhotoArchiveFileCurrentV1(descriptor(), { ...f.options, signal: stop.signal,
		fetch: () => { f.events.push('fetch-held'); return arrival.promise; } });
	void work.catch(() => undefined);
	try {
		await waitForEvent(f.events, 'fetch-held'); stop.abort(reason);
		assert.equal(await remainsPending(work), true); assert.equal(f.events.includes('finish'), false);
		const body = new ReadableStream<Uint8Array<ArrayBuffer>>({ async cancel() {
			f.events.push('late-reader-cancel'); await cancelled.promise;
		} }, { highWaterMark: 0 });
		arrival.resolve(response(Uint8Array.of(), 0, 4, 5, { stream: body }));
		await waitForEvent(f.events, 'late-reader-cancel'); assert.equal(await remainsPending(work), true);
		assert.equal(f.events.includes('finish'), false); cancelled.resolve();
		await assert.rejects(work, error => Object.is(error, reason)); assert.equal(f.deleted(), 1);
	} finally { arrival.reject(new Error('Test cleanup')); cancelled.resolve(); await work.catch(() => undefined); }
});

test('Light archive preserves a native reader failure and reports an independent failed cancellation', async () => {
	const primary = Object.freeze({ network: 'failed' }), f = fixture();
	const body = new ReadableStream<Uint8Array<ArrayBuffer>>({ pull(controller) { controller.error(primary); } }, { highWaterMark: 0 });
	await assert.rejects(materializeDesktopPhotoArchiveFileCurrentV1(descriptor(), { ...f.options,
		fetch: async () => response(Uint8Array.of(), 0, 4, 5, { stream: body }) }), error => Object.is(error, primary));
	assert.equal(f.deleted(), 1);
	const other = fixture(), stop = new AbortController(), reason = Symbol('cancel'), cleanup = Object.freeze({ cancel: 'failed' });
	const pending = new ReadableStream<Uint8Array<ArrayBuffer>>({ pull() { other.events.push('read-pending'); }, cancel() { throw cleanup; } }, { highWaterMark: 0 });
	const work = materializeDesktopPhotoArchiveFileCurrentV1(descriptor(), { ...other.options, signal: stop.signal,
		fetch: async () => response(Uint8Array.of(), 0, 4, 5, { stream: pending }) });
	void work.catch(() => undefined);
	await waitForEvent(other.events, 'read-pending'); stop.abort(reason);
	await assert.rejects(work, error => { assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [reason, cleanup]); return true; });
	assert.equal(other.deleted(), 1); assert.equal(other.events.filter(value => value === 'finish').length, 1);
});

test('Light archive close failure still aborts the staged writer, releases the grant and preserves its opaque primary', async () => {
	const primary = Proxy.revocable({}, {}); primary.revoke(); const f = fixture({ closeFailure: primary.proxy });
	let caught: unknown;
	try { await materializeDesktopPhotoArchiveFileCurrentV1(descriptor(), f.options); }
	catch (error) { caught = error; }
	assert.equal(caught, primary.proxy);
	assert.equal(f.deleted(), 1); assert.ok(f.events.indexOf('finish') > f.events.indexOf('abort-end')); assert.equal(f.events.includes('get-file'), false);
});

test('Light archive retains its stage after writable-abort refusal and reports both primary and cleanup failures', async () => {
	const primary = Object.freeze({ write: 'quota failure' }), cleanup = Object.freeze({ abort: 'refused' });
	const f = fixture({ writeFailure: primary, abortFailure: cleanup });
	await assert.rejects(materializeDesktopPhotoArchiveFileCurrentV1(descriptor(), f.options), error => {
		assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [primary, cleanup]); return true;
	});
	assert.equal(f.deleted(), 0); assert.equal(f.events.filter(value => value === 'finish').length, 1);
});

test('Light archive release failure deletes an otherwise complete unconsumed stage before rejecting', async () => {
	const primary = Object.freeze({ release: 'failed' }), f = fixture({ finishFailure: primary });
	await assert.rejects(materializeDesktopPhotoArchiveFileCurrentV1(descriptor(), f.options), error => Object.is(error, primary));
	assert.equal(f.deleted(), 1); assert.ok(f.events.indexOf('remove-start') > f.events.indexOf('close-end'));
});

test('Light archive never deletes a pre-existing staging directory and rejects a wrong native File result', async () => {
	const collision = fixture({ collision: true });
	await assert.rejects(materializeDesktopPhotoArchiveFileCurrentV1(descriptor(), collision.options), /already exists/u);
	assert.equal(collision.deleted(), 0); assert.equal(collision.events.includes('writable-open'), false);
	for (const file of [() => new File([Uint8Array.of(1)], 'Library.liscape'), () => new File([new Uint8Array(5)], 'other.liscape'),
		() => ({ name: 'Library.liscape', size: 5 } as File)]) {
		const f = fixture({ file }); await assert.rejects(materializeDesktopPhotoArchiveFileCurrentV1(descriptor(), f.options));
		assert.equal(f.deleted(), 1); assert.equal(f.events.filter(value => value === 'finish').length, 1);
	}
});

test('Light archive explicit close is an idempotent joined deletion barrier including cleanup failure', async () => {
	const cleanup = Object.freeze({ remove: 'failed' }), f = fixture({ removeFailure: cleanup });
	const staged = await materializeDesktopPhotoArchiveFileCurrentV1(descriptor(), f.options), first = staged.close();
	assert.equal(staged.close(), first); await assert.rejects(first, error => Object.is(error, cleanup));
	assert.equal(staged.close(), first); assert.equal(f.events.filter(value => value === 'remove-start').length, 1);
});
