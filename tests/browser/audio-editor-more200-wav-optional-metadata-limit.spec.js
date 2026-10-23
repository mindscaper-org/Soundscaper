/* SPDX-License-Identifier: AGPL-3.0-only */

import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, sourcePeakChannels } from './audio-editor-test-helpers.js';
import { encodeWav } from '../../src/common/editor/wav.js';

test('File Import keeps RF64 audio and independent recorder metadata when optional iXML exceeds its budget', async ({ page }) => {
	const samples = Float32Array.from({ length: 4800 }, (_, frame) => .4 * Math.sin(2 * Math.PI * 440 * frame / 48_000));
	const base = Uint8Array.from(encodeWav([samples], { container: 'bw64', sampleRate: 48_000, dither: false,
		bext: { description: 'Retained recorder metadata' }, metadata: { title: 'Retained title' },
		markers: [{ sampleOffset: 1200, label: 'Retained cue' }] }));
	base.set(new TextEncoder().encode('RF64'));
	const length = 16 * 1024 ** 2 + 1;
	const header = new Uint8Array(8); header.set(new TextEncoder().encode('iXML')); new DataView(header.buffer).setUint32(4, length, true);
	const xml = new Uint8Array(length).fill(32); xml.set(new TextEncoder().encode('<BWFXML><NOTE>'));
	xml.set(new TextEncoder().encode('</NOTE></BWFXML>'), xml.length - 16);
	new DataView(base.buffer).setBigUint64(20, BigInt(base.length + 8 + length + 1 - 8), true);
	new DataView(base.buffer).setBigUint64(36, BigInt(samples.length), true);
	const bytes = Buffer.concat([base, header, xml, Uint8Array.of(0)]);
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-import-input]').setInputFiles({ name: 'Recorder.wav', mimeType: 'audio/wav', buffer: bytes });
	await expect.poll(async () => await editor.getAttribute('data-clip-count') === '1' ? 'imported'
		: await editor.locator('[data-editor-toast="workspace-status-error"]').isVisible() ? 'failed' : 'pending', { timeout: 30_000 }).toBe('imported');
	const peak = await sourcePeakChannels(page, 'Recorder.wav');
	expect(peak.channels[0].maximum).toBeGreaterThan(.39);
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const document = JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloading))['project.json']));
	expect(document.metadata.bext.description).toBe('Retained recorder metadata');
	const source = document.sources.find(source => source.name === 'Recorder.wav');
	expect(source.frameCount).toBe(samples.length);
	expect(source.provenance.contributions[0].metadata.normalized.title).toBe('Retained title');
	expect(JSON.stringify(document)).toContain('Retained cue');
});
