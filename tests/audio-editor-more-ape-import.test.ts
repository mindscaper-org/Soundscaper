/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { encodeDedicatedAudioPcm } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';
import { prepareImportedSourceProvenance } from '../src/common/editor/controller/import/internal/imported-source-provenance.ts';

function apeTags(entries: Readonly<Record<string, string>>): Blob {
	const encoder = new TextEncoder();
	const items = Object.entries(entries).map(([key, text]) => {
		const value = encoder.encode(text);
		const item = new Uint8Array(9 + key.length + value.length);
		new DataView(item.buffer).setUint32(0, value.length, true);
		item.set(encoder.encode(key), 8); item.set(value, 9 + key.length);
		return item;
	});
	const footer = new Uint8Array(32);
	footer.set(encoder.encode('APETAGEX'));
	const view = new DataView(footer.buffer);
	view.setUint32(8, 2000, true);
	view.setUint32(12, 32 + items.reduce((size, item) => size + item.length, 0), true);
	view.setUint32(16, items.length, true);
	return new Blob([...items, footer]);
}

test('File Import retains a complete APE recording date when a compatibility Year tag follows it', async () => {
	const pcm = Float32Array.from({ length: 480 }, (_value, index) => Math.sin(index / 19) / 4);
	const encoded = await encodeDedicatedAudioPcm({ format: 'wavpack', input: new Uint8Array(pcm.buffer), frameCount: pcm.length,
		channelCount: 1, sampleRate: 48_000, settings: { compressionLevel: 2 }, maximumOutputBytes: 65536 }, {
		loadPayload: async (_format, url) => Uint8Array.from(await readFile(url)),
	});
	for (const tags of [{ Date: '2026-10-22', Year: '2026' }, { Year: '2026', Date: '2026-10-22' }]) {
		const file = new File([encoded, apeTags(tags)], 'Field-recording.wv', { type: 'audio/wavpack' });
		const prepared = await prepareStreamedAudioImport(file);
		assert.equal(prepared.descriptor.frameCount, pcm.length);
		prepared.dispose();
		const provenance = await prepareImportedSourceProvenance(file, { createContributionId: () => 'field-recording' });
		assert.equal(provenance.classification, 'imported');
		assert.equal(provenance.contributions[0]?.metadata.normalized.date, '2026-10-22');
		assert.equal(provenance.contributions[0]?.metadata.raw.Year, '2026');
	}
});
