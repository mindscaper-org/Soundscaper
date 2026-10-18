/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';

test('Lightscaper native media metadata capture precedes demanded bounded first and second body passes', { concurrency: false }, async () => {
	const read = Blob.prototype.arrayBuffer, size = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;
	const observed: number[] = [];
	Blob.prototype.arrayBuffer = function (): Promise<ArrayBuffer> {
		observed.push(Number(Reflect.apply(size, this, [])));
		return Reflect.apply(read, this, []) as Promise<ArrayBuffer>;
	};
	try {
		// No production module is imported before the transparent actual native
		// reader observer. It returns genuine platform bytes, never fake data.
		const { captureLightscaperNativePhotoMediaWriteCurrentV1: capture,
			digestLightscaperNativePhotoMediaWriteCurrentV1: digest,
			lightscaperNativePhotoMediaWriteChunksCurrentV1: chunks } = await import('../desktop/lightscaper-native-photo-media-blob-current-v1.ts');
		const length = 2 * 1024 * 1024 + 17, captured = await capture('body', new Blob([new Uint8Array(length)]), { custom: new Blob(['meta']) });
		assert.deepEqual(observed, [4]);
		await digest(captured); assert.deepEqual(observed, [4, 1024 * 1024, 1024 * 1024, 17]);
		let total = 0; for await (const bytes of chunks(captured)) total += bytes.length;
		assert.equal(total, length); assert.deepEqual(observed, [4, 1024 * 1024, 1024 * 1024, 17, 1024 * 1024, 1024 * 1024, 17]);
	} finally { Blob.prototype.arrayBuffer = read; }
});
