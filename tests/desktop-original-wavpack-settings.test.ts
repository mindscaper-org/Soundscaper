/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readOriginalWavPackHeader } from '../src/common/editor/desktop-original-wavpack-settings.ts';
import { resolveDesktopOriginalExportSettings } from '../src/common/editor/desktop-original-export-settings.ts';
import { WAVPACK_SPEAKER_ROLE_RECORDINGS } from './helpers/wavpack-speaker-role-fixture.ts';

for (const recording of WAVPACK_SPEAKER_ROLE_RECORDINGS) test(`Original role proof seeks bounded metadata for ${recording.name}`, async () => {
	const bytes = Uint8Array.from(Buffer.from(recording.base64, 'base64'));
	const file = new Blob([bytes]);
	const ranges: [number, number][] = [];
	const header = await readOriginalWavPackHeader({ size: file.size,
		slice(start, end) { ranges.push([start, end]); return file.slice(start, end); } }, new Uint8Array(), recording.channels);
	assert.equal(header !== null, recording.available);
	assert.ok(ranges.every(([start, end]) => end - start <= 32));
	// Every fixture contains an ordinary native RIFF wrapper as its first metadata.
	const wrapperEnd = 34 + bytes[33]! * 2;
	assert.ok(ranges.every(([start, end]) => start >= wrapperEnd || end <= 34), 'wrapper payload is never loaded');
	assert.ok(ranges.length < 32);
});

test('Original refuses truncated WavPack role records and unfinished audio groups', async () => {
	const recording = WAVPACK_SPEAKER_ROLE_RECORDINGS.find(value => value.name === 'Unspecified stereo'); assert.ok(recording);
	const original = Uint8Array.from(Buffer.from(recording.base64, 'base64'));
	const firstBlockEnd = new DataView(original.buffer).getUint32(4, true) + 8;
	for (const bytes of [original.slice(0, firstBlockEnd), original.slice(0, -1), original.slice(0, 31)]) {
		const file = new File([bytes], 'Truncated.wv');
		assert.equal(await resolveDesktopOriginalExportSettings(file, [{ kind: 'audio', sampleRate: 48_000, channelCount: 2 }]), null);
	}
	const bad = Uint8Array.from(original);
	bad[33] = 0xff; // The first wrapper record claims bytes beyond its block.
	assert.equal(await readOriginalWavPackHeader(new Blob([bad]), bad, 2), null);
});
