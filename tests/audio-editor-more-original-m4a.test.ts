/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { BlobSource, Input, MP4 } from 'mediabunny';
import { resolveDesktopOriginalExportSettings } from '../src/common/editor/desktop-original-export-settings.ts';
import { readDesktopOriginalM4aMovie } from '../src/common/editor/desktop-original-m4a-movie.ts';
import { aacLcM4a44_100Fixture } from './helpers/os-audio-codec-fixtures.ts';

test('a large unrelated movie box does not disable Original export for a valid AAC M4A', async () => {
	const original = aacLcM4a44_100Fixture();
	const movie = original.slice(28, 806);
	const chunkTable = Buffer.from(movie).indexOf('stco');
	assert.ok(chunkTable > 0);
	new DataView(movie.buffer).setUint32(chunkTable + 12, 36, false);
	const padding = new Uint8Array(2 * 1024 * 1024);
	new DataView(padding.buffer).setUint32(0, padding.length, false);
	padding.set(new TextEncoder().encode('free'), 4);
	const movieHeader = movie.slice(0, 8);
	new DataView(movieHeader.buffer).setUint32(0, movie.length + padding.length, false);
	const file = new File([original.slice(0, 28), original.slice(814), padding,
		movieHeader, padding, movie.slice(8)], 'large-movie.m4a', { type: 'audio/mp4' });
	const input = new Input({ source: new BlobSource(file), formats: [MP4] });
	try {
		const audio = await input.getPrimaryAudioTrack();
		assert.ok(audio);
		assert.equal(await audio.getCodec(), 'aac');
		assert.equal(await audio.getSampleRate(), 44_100);
	} finally { input.dispose(); }
	const reads: number[] = [];
	const metadata = await readDesktopOriginalM4aMovie({ size: file.size, slice(start, end) {
		reads.push(end - start);
		return file.slice(start, end);
	} }, 1024 * 1024);
	assert.ok(metadata);
	assert.ok(reads.every(length => length <= 1024 * 1024));
	assert.ok(reads.reduce((sum, length) => sum + length, 0) < 1024 * 1024);
	const settings = await resolveDesktopOriginalExportSettings(file,
		[{ id: 'audio', kind: 'audio', sampleRate: 44_100, channelCount: 2 }]);
	assert.ok(settings);
	assert.equal(settings.format, 'aac-m4a');
	assert.equal(settings.sampleRate, 44_100);
});
