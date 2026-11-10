/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeWav } from '../src/common/editor/wav.js';
import { createFreesoundUploadMetadataDefaults } from '../src/common/editor/freesound-upload-metadata.ts';
import { normalizeSourceProvenance } from '../src/common/editor/source-provenance.ts';
import { importFreesoundCustody, independentUploadedWav, transferFreesoundFile } from './helpers/freesound-upload-archive-custody.ts';

for (const [name, expectedName] of [
	['  Field take.wav', 'Field take.wav'],
	['Field\ntake.wave', 'Field-take.wav'],
	['Field\u007ftake.wav', 'Field-take.wav'],
	[`${'a'.repeat(219)}🎤.wave`, `${'a'.repeat(219)}🎤.wav`],
] as const) test(`Freesound authenticated file ${JSON.stringify(name)} preserves every PCM sample through independent Scape`, async context => {
	const originalBytes = Uint8Array.from(encodeWav([Float32Array.of(.25, -.5)], { sampleRate: 48_000, bitDepth: 16 }));
	const original = new File([originalBytes], name, { type: 'audio/wav', lastModified: 123 });
	const converted = name.endsWith('.wave');
	// The original 16-bit writer dithers too: validate that input independently,
	// then preserve its actual samples rather than ignoring the original LSBs.
	const input = await independentUploadedWav(original, 48_000, 2, 16, [.25, -.5]);
	const { file, preparations, item } = await transferFreesoundFile(original, expectedName, 48_000);
	assert.equal(preparations, converted ? 1 : 0); assert.equal(item.fileName, converted ? expectedName : name);
	assert.equal(original.name, name); assert.equal(original.lastModified, 123);
	assert.deepEqual(new Uint8Array(await original.arrayBuffer()), originalBytes);
	const pcm = await independentUploadedWav(file, 48_000, 2, converted ? 24 : 16, Array.from(input[0]!), converted ? 2 / 8_388_608 : 0);
	await importFreesoundCustody(context, file, pcm, 48_000);
});

test('Freesound low-rate WAV alias uses the real CPU conversion and authenticated endpoint without changing clocks or PCM', async context => {
	const expected = [0, .25, -.5, .75];
	const bytes = Uint8Array.from(encodeWav([Float32Array.from(expected)], { sampleRate: 1_000, bitDepth: 16 }));
	const original = new File([bytes], 'measurement.wave', { type: 'audio/wav', lastModified: 456 });
	const input = await independentUploadedWav(original, 1_000, 4, 16, expected);
	const { file, preparations } = await transferFreesoundFile(original, 'measurement.wav', 1_000);
	assert.equal(preparations, 1);
	const pcm = await independentUploadedWav(file, 1_000, 4, 24, Array.from(input[0]!));
	await importFreesoundCustody(context, file, pcm, 1_000);
	assert.deepEqual(new Uint8Array(await original.arrayBuffer()), bytes);
});

for (const custom of [true, false]) test(`Freesound ${custom ? 'custom' : 'ordinary'} authored metadata survives actual Bin import, history and fresh Scape`, async context => {
	const metadata: Readonly<Record<string, string>> = custom ? { constructor: 'Ada', toString: 'Field take', artist: 'Recorder' } : { artist: 'Recorder' };
	const expected = Float32Array.from({ length: 4800 }, (_, frame) => .25 * Math.sin(2 * Math.PI * 1000 * frame / 48_000));
	const bytes = Uint8Array.from(encodeWav([expected], { sampleRate: 48_000, float: true, metadata }));
	const project = await importFreesoundCustody(context, new File([bytes], 'Credits.wav', { type: 'audio/wav' }), [expected], 48_000);
	const source = project.sources[0]; assert.ok(source?.kind === 'audio');
	const provenance = normalizeSourceProvenance(source.provenance);
	const defaults = createFreesoundUploadMetadataDefaults({ fileName: 'Credits.wav', source: { ...source, provenance } });
	const lines = defaults.description.split('\n');
	assert.ok(lines.includes('Artist: Recorder'), defaults.description);
	if (custom) { assert.ok(lines.includes('Constructor: Ada'), defaults.description); assert.ok(lines.includes('ToString: Field take'), defaults.description); }
	else { assert.ok(!lines.some(line => /^(?:Constructor|ToString):/u.test(line))); }
	assert.doesNotMatch(defaults.description, /\[native code\]|function Object/u);
});
