/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeLegacyAupProject, LegacyAupError } from '../src/common/editor/aup-legacy.js';
import { encodeAiff } from '../src/common/editor/aiff.js';
import { encodeWav } from '../src/common/editor/wav.js';

function aliasProject(reference = 'C:\\Recordings\\Take.wav', channel = 1, start = 4095, length = 2) {
	return new File([`<project rate="48000"><wavetrack name="Alias" rate="48000"><waveclip offset="2">
		<sequence numsamples="${String(length + 1)}">
		<waveblock start="0"><silentblockfile len="1"/></waveblock>
		<waveblock start="1"><pcmaliasblockfile aliasfile="${reference}" aliasstart="${String(start)}"
			aliaslen="${String(length)}" aliaschannel="${String(channel)}"/></waveblock>
		</sequence></waveclip></wavetrack></project>`], 'edit.aup');
}

function pcmFile(format: 'wav' | 'aiff') {
	const left = new Float32Array(4098).fill(0.125);
	const right = new Float32Array(4098);
	right.set([-0.5, 0.75], 4095);
	const samples = [left, right];
	const bytes = format === 'wav'
		? encodeWav(samples, { sampleRate: 44_100, float: true, bitDepth: 32, dither: false })
		: encodeAiff(samples, { sampleRate: 44_100, bitDepth: 16, dither: false });
	assert.ok(bytes instanceof Uint8Array);
	return new File([Uint8Array.from(bytes)], `Take.${format}`);
}

for (const format of ['wav', 'aiff'] as const) {
	test(`legacy aliases import exact ${format.toUpperCase()} samples across PCM chunks at the Audacity track rate`, async () => {
		const original = pcmFile(format);
		const decoded = await decodeLegacyAupProject(aliasProject(`C:\\Recordings\\Take.${format}`), [original]);
		assert.deepEqual(decoded.consumedDataFiles, [original]);
		const track = decoded.tracks[0]!;
		assert.ok('clips' in track);
		assert.equal(track.rate, 48_000);
		assert.equal(track.clips[0]?.startSeconds, 2);
		assert.deepEqual(track.clips[0]?.channels[0], Float32Array.of(0, -0.5, 0.75));
	});
}

test('legacy aliases report missing, ambiguous, and out-of-range authorized originals', async () => {
	const original = pcmFile('wav');
	const errorCode = (code: string) => (error: unknown) => error instanceof LegacyAupError && error.code === code;
	await assert.rejects(decodeLegacyAupProject(aliasProject(), []), errorCode('MISSING_ALIAS_FILES'));
	await assert.rejects(decodeLegacyAupProject(aliasProject(), [original, pcmFile('wav')]), errorCode('AMBIGUOUS_ALIAS_FILE'));
	await assert.rejects(decodeLegacyAupProject(aliasProject(undefined, 2), [original]), errorCode('INVALID_ALIAS_RANGE'));
	await assert.rejects(decodeLegacyAupProject(aliasProject(undefined, 1, 4097), [original]), errorCode('INVALID_ALIAS_RANGE'));
	await assert.rejects(decodeLegacyAupProject(aliasProject(undefined, -1), [original]), errorCode('INVALID_ALIAS_RANGE'));
});

test('legacy aliases match the selected relative directory before falling back to a unique basename', async () => {
	const intended = Object.defineProperty(pcmFile('wav'), 'webkitRelativePath', { value: 'Transfer/Recordings/Take.wav' });
	const other = Object.defineProperty(pcmFile('wav'), 'webkitRelativePath', { value: 'Transfer/Other/Take.wav' });
	const decoded = await decodeLegacyAupProject(aliasProject(), [other, intended]);
	assert.deepEqual(decoded.consumedDataFiles, [intended]);
});

test('legacy aliases charge bounded reads to the existing block budget', async () => {
	const original = pcmFile('wav');
	let bytes = 0;
	const file = Object.assign(original, {
		arrayBuffer() { return assert.fail('An alias must never materialize the whole original'); },
		slice(start: number, end: number) {
			return { arrayBuffer: async () => { bytes += end - start; return Blob.prototype.slice.call(original, start, end).arrayBuffer(); } };
		},
	});
	await assert.rejects(decodeLegacyAupProject(aliasProject(), [file], { blockLimits: { maximumSelectedBlockBytes: 128 } }),
		(error: unknown) => error instanceof LegacyAupError && error.code === 'PROJECT_BLOCK_BYTES_LIMIT');
	assert.ok(bytes > 0 && bytes <= 128);
});
