/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { strFromU8, unzipSync, zipSync } from 'fflate';
import { createFramescaperCompatibilityArchive, qualifyFramescaperCompatibilityArchive } from './helpers/framescaper-compatibility-publisher.ts';

function input(name: string, frequency: number, amplitudes: readonly [number, number]) {
	const bytes = new Uint8Array(44 + 38_400 * 4), view = new DataView(bytes.buffer);
	const ascii = (offset: number, value: string) => bytes.set(new TextEncoder().encode(value), offset);
	ascii(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); ascii(8, 'WAVEfmt ');
	view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
	view.setUint32(24, 48_000, true); view.setUint32(28, 192_000, true);
	view.setUint16(32, 4, true); view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, bytes.length - 44, true);
	for (let frame = 0; frame < 38_400; frame++) for (let channel = 0; channel < 2; channel++) {
		const value = Math.sin(2 * Math.PI * frequency * frame / 48_000 + (channel ? Math.PI / 3 : 0)) * amplitudes[channel]!;
		view.setInt16(44 + (frame * 2 + channel) * 2, Math.round(value * 32_767), true);
	}
	return { name, bytes, frequency, amplitudes };
}

for (const pair of [false, true]) test(`actual Framescaper publisher qualifies ${pair ? 'two distinct' : 'one'} WAV source and native Scape`, async () => {
	const files = [input('browser-tone-a.wav', 330, [.35, .35]), ...(pair ? [input('browser-asymmetric-stereo-tone.wav', 275, [.1, .7])] : [])];
	const result = await createFramescaperCompatibilityArchive(files);
	assert.ok(result.projectId); assert.ok(result.bytes.byteLength > 0);
	const document: unknown = JSON.parse(strFromU8(unzipSync(result.bytes)['project.json']!));
	assert.ok(document && typeof document === 'object' && 'id' in document);
	assert.equal(document.id, result.projectId);
	assert.equal((await qualifyFramescaperCompatibilityArchive(result.bytes, files)).id, result.projectId);
});

test('publisher custody refuses a changed source clock instead of silently using fixture expectations', async () => {
	const file = input('browser-tone-a.wav', 330, [.35, .35]);
	new DataView(file.bytes.buffer).setUint32(24, 44_100, true);
	new DataView(file.bytes.buffer).setUint32(28, 176_400, true);
	await assert.rejects(createFramescaperCompatibilityArchive([file]), /sampleRate|48000/u);
});

test('publisher custody authenticates the final source frame independently of the input PCM', async () => {
	const file = input('browser-tone-a.wav', 330, [.35, .35]);
	new DataView(file.bytes.buffer).setInt16(file.bytes.length - 2, 0, true);
	await assert.rejects(createFramescaperCompatibilityArchive([file]), /sample 38399/u);
});

test('publisher qualification rejects a corrupt Scape asset digest before browser delivery', async () => {
	const file = input('browser-tone-a.wav', 330, [.35, .35]);
	const original = await createFramescaperCompatibilityArchive([file]);
	const entries = unzipSync(original.bytes), manifest = JSON.parse(strFromU8(entries['manifest.json']!)) as { assets: { sha256: string }[] };
	assert.ok(manifest.assets[0]); manifest.assets[0].sha256 = '0'.repeat(64);
	entries['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest));
	await assert.rejects(qualifyFramescaperCompatibilityArchive(zipSync(entries), [file]), /digest|sha256/u);
});
