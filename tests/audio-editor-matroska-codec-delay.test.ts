/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readMatroskaRoundedCodecDelay } from '../src/common/editor/matroska-opus-end-padding.ts';
import { opusPaddingAvFixture } from './helpers/ordinary-ogg-opus-fixture.ts';

test('Matroska codec-delay compensation selects the audio track and retains the demuxer tick rounding', async () => {
	const file = opusPaddingAvFixture();
	assert.equal(await readMatroskaRoundedCodecDelay(file, 2), .007);
	assert.equal(await readMatroskaRoundedCodecDelay(file, 1), 0);
	assert.equal(await readMatroskaRoundedCodecDelay(new Blob(['other container']), 2), 0);
	const abort = new AbortController();
	abort.abort(new DOMException('Cancelled', 'AbortError'));
	await assert.rejects(readMatroskaRoundedCodecDelay(file, 2, abort.signal), /Cancelled/u);
});

test('codec-delay admission reads only bounded metadata and refuses a truncated segment', async () => {
	const source = opusPaddingAvFixture(), reads: number[] = [];
	class ObservedBlob extends Blob {
		override slice(start = 0, end = this.size, type = ''): Blob {
			reads.push(Math.min(end, this.size) - start);
			return super.slice(start, end, type);
		}
	}
	const file = new ObservedBlob([source, new Uint8Array(32 * 1024 ** 2)]);
	assert.equal(await readMatroskaRoundedCodecDelay(file, 2), .007);
	assert.ok(Math.max(...reads) <= 16);
	assert.ok(reads.reduce((sum, length) => sum + length, 0) < 4096);
	await assert.rejects(readMatroskaRoundedCodecDelay(source.slice(0, source.size - 1), 2), /truncated/u);
});
