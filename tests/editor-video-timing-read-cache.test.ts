/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoTimingDemuxReader } from '../src/common/editor/video-timing-demux-reader.ts';
import { createDesktopSelectedRangeBlob, retireDesktopSelectedRangeBlob } from '../src/common/editor/desktop-selected-range-blob.ts';

test('nearby container headers share bounded reads and later scans reuse their bytes', async context => {
	const original = Blob.prototype.arrayBuffer;
	const reads: number[] = [];
	context.mock.method(Blob.prototype, 'arrayBuffer', function (this: Blob) {
		reads.push(this.size);
		return original.call(this);
	});
	const bytes = Uint8Array.from({ length: 128 * 1024 }, (_, index) => index & 255);
	const file = new Blob([bytes]);
	const timing = createVideoTimingDemuxReader(file);
	assert.deepEqual(await timing.read(128, 32), bytes.slice(128, 160));
	assert.deepEqual(await timing.read(140, 12), bytes.slice(140, 152));
	assert.deepEqual(await timing.read(9000, 16), bytes.slice(9000, 9016));
	const padding = createVideoTimingDemuxReader(file, { maximumTotalBytes: 16 * 1024 ** 2 });
	assert.deepEqual(await padding.read(130, 13), bytes.slice(130, 143));
	assert.equal(reads.length, 1, 'Tiny header reads and the second scan must not each perform file I/O.');
	assert.ok(reads[0]! <= 1024 ** 2);
});

test('cached bytes are privately owned across readers and page boundaries', async () => {
	const bytes = Uint8Array.from({ length: 1024 }, (_, index) => index & 255);
	const file = new Blob([bytes]);
	const first = createVideoTimingDemuxReader(file);
	const result = await first.read(61, 16);
	result.fill(255);
	const second = createVideoTimingDemuxReader(file);
	assert.deepEqual(await second.read(63, 12), bytes.slice(63, 75));
	assert.deepEqual(await second.readAtMost(1020, 16), bytes.slice(1020));
});

test('logical read budgets and cancellation apply even to cached header bytes', async () => {
	const file = new Blob([new Uint8Array(1024)]);
	await createVideoTimingDemuxReader(file).read(0, 32);
	const limited = createVideoTimingDemuxReader(file, { maximumTotalBytes: 32 });
	await limited.read(0, 16);
	await limited.read(0, 16);
	await assert.rejects(limited.read(0, 1), /budget/u);
	const abort = new AbortController();
	const cancelled = createVideoTimingDemuxReader(file, { signal: abort.signal });
	abort.abort(new Error('Project changed.'));
	await assert.rejects(cancelled.read(0, 16), /Project changed/u);
});

test('Cancel releases an in-flight read-ahead without publishing its cached pages', async context => {
	const original = Blob.prototype.arrayBuffer;
	let entered!: () => void, release!: () => void;
	const started = new Promise<void>(resolve => { entered = resolve; });
	const gate = new Promise<void>(resolve => { release = resolve; });
	let reads = 0;
	context.mock.method(Blob.prototype, 'arrayBuffer', async function (this: Blob) {
		reads++;
		if (reads === 1) { entered(); await gate; }
		return original.call(this);
	});
	const file = new Blob([new Uint8Array(1024)]);
	const abort = new AbortController();
	let settled = false;
	const pending = createVideoTimingDemuxReader(file, { signal: abort.signal }).read(0, 16);
	const observed = pending.then(() => { settled = true; }, () => { settled = true; });
	await started; abort.abort();
	await new Promise<void>(resolve => { setImmediate(resolve); });
	try { assert.equal(settled, true, 'Cancellation cannot wait for the backing file read.'); }
	finally { release(); await observed; }
	await createVideoTimingDemuxReader(file).read(0, 16);
	assert.equal(reads, 2, 'Cancelled read-ahead must not populate a shared cache.');
});

test('read ahead stays inside the existing physical I/O ceiling and reserves room for sparse headers', async context => {
	const original = Blob.prototype.arrayBuffer;
	let physicalBytes = 0;
	context.mock.method(Blob.prototype, 'arrayBuffer', function (this: Blob) {
		physicalBytes += this.size;
		assert.ok(this.size <= 1024 ** 2);
		return original.call(this);
	});
	const file = new Blob([new Uint8Array(20 * 1024 ** 2)]);
	const maximumTotalBytes = 4 * 1024 ** 2;
	const reader = createVideoTimingDemuxReader(file, { maximumTotalBytes });
	for (let offset = 0; offset < file.size; offset += 256 * 1024) await reader.read(offset, 16);
	assert.ok(physicalBytes <= maximumTotalBytes);
});

test('metadata cache eviction releases old owners without changing their results', async context => {
	const original = Blob.prototype.arrayBuffer;
	let reads = 0;
	context.mock.method(Blob.prototype, 'arrayBuffer', function (this: Blob) { reads++; return original.call(this); });
	const first = new Blob([new Uint8Array(1024)]);
	await createVideoTimingDemuxReader(first).read(0, 16);
	await createVideoTimingDemuxReader(first).read(0, 16);
	assert.equal(reads, 1);
	for (let index = 0; index < 4; index++) await createVideoTimingDemuxReader(new Blob([new Uint8Array(1024)])).read(0, 16);
	await createVideoTimingDemuxReader(first).read(0, 16);
	assert.equal(reads, 6);
});

test('virtual and overridden Blob readers keep their live read authority', async () => {
	let readable = true;
	class VirtualBlob extends Blob {
		override slice(start = 0, end = this.size): Blob {
			if (!readable) throw new Error('Read authority retired.');
			return super.slice(start, end);
		}
	}
	const reader = createVideoTimingDemuxReader(new VirtualBlob([new Uint8Array(128)]));
	await reader.read(0, 16);
	readable = false;
	await assert.rejects(reader.read(0, 16), /authority retired/u);
	const native = new Blob([new Uint8Array(128)]);
	const cached = createVideoTimingDemuxReader(native);
	await cached.read(0, 16);
	Object.defineProperty(native, 'slice', { value: () => { throw new Error('Native reader was replaced.'); } });
	await assert.rejects(cached.read(0, 16), /reader was replaced/u);
});

test('desktop selected ranges batch headers while cached hits still check their live capability', async () => {
	const size = 128 * 1024, id = 'a'.repeat(64);
	let fetches = 0;
	const blob = createDesktopSelectedRangeBlob({ id, name: 'video.webm', size, mimeType: 'video/webm',
		readProfile: 'selected-range-v1', lastModified: 0,
		url: `framescaper-app://bundle/_desktop/read/selected-range-v1/${id}/video.webm`,
	}, { fetch: async (_url, init) => {
		fetches++;
		const range = /^bytes=(\d+)-(\d+)$/u.exec(new Headers(init.headers).get('Range')!)!;
		const start = Number(range[1]), end = Number(range[2]);
		return new Response(new Uint8Array(end - start + 1).fill(42), { status: 206, headers: {
			'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}`,
			'Content-Length': String(end - start + 1), 'Content-Type': 'video/webm',
		} });
	} });
	await createVideoTimingDemuxReader(blob).read(0, 32);
	const second = createVideoTimingDemuxReader(blob);
	assert.deepEqual(await second.read(8, 13), new Uint8Array(13).fill(42));
	assert.equal(fetches, 1);
	retireDesktopSelectedRangeBlob(blob);
	await assert.rejects(second.read(8, 13), /released/u);
});
