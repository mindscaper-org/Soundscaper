/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, chooseFileAction, disableNativeSavePicker, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { inspectWavBlobPcm } from '../../src/common/editor/wav-import.js';
import { createWavBlobPcmChunkReader } from '../../src/common/editor/wav-pcm-chunk-reader.ts';

for (const pan of [{ track: 1, master: 0 }, { track: -1, master: 0 }, { track: 0, master: 1 },
	{ track: 0, master: -1 }, { track: 0, master: 0 }, { track: 0, master: 0, automated: true }]) {
	test(`mono File Export retains both panner sides (track ${String(pan.track)}, master ${String(pan.master)}, automated ${String(!!pan.automated)})`, async ({ page }) => {
		const source = createAudioSource({ id: 'voice', sampleRate: 48_000, channelCount: 1, frameCount: 24_000 });
		const project = createSoundscaperProject({ id: `mono-pan-${String(pan.track)}-${String(pan.master)}-${String(!!pan.automated)}`, masterChannels: 1,
			sources: [source], clips: [createAudioClip({ id: 'voice-clip', sourceId: source.id, durationFrames: source.frameCount, sourceDurationFrames: source.frameCount })],
			tracks: [createAudioTrack({ id: 'voice-track', pan: pan.track, clipIds: ['voice-clip'] })],
			master: { gain: 1, pan: pan.master, mute: false, solo: false, effectsActive: true, effects: [] },
			automationLanes: pan.automated ? [{ id: 'track-pan', address: { kind: 'strip', strip: { kind: 'track', id: 'voice-track' }, parameterId: 'pan' },
				timebase: 'absolute-samples', points: [{ id: 'left', position: 0, value: -1 }, { id: 'right', position: 24_000, value: 1 }], segments: [{ kind: 'linear' }] }] : [],
		});
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: project.id });
		let blob;
		try {
			const writer = await store.beginSourceWrite(source.storageKey, source);
			await writer.write([new Float32Array(source.frameCount).fill(.1)]); await writer.commit();
			blob = (await exportScapeProject(project, store)).blob;
		} finally { await store.close(); }
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/');
		const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
		await (await choosing).setFiles({ name: 'Mono pan.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
		await expect(editor).toHaveAttribute('data-project-id', project.id);
		const expected = await page.evaluate(async (values) => {
			// The reference keeps both authored panners and uses Web Audio's mono
			// speaker downmix after each, rather than choosing the panner's left.
			const context = new OfflineAudioContext(1, 24_000, 48_000);
			const source = context.createBufferSource();
			const buffer = context.createBuffer(1, 24_000, 48_000); buffer.getChannelData(0).fill(.1); source.buffer = buffer;
			let output = source;
			for (const [index, value] of [values.track, values.master].entries()) {
				const panner = context.createStereoPanner(); panner.pan.value = value;
				if (values.automated && index === 0) {
					panner.pan.setValueAtTime(-1, 0); panner.pan.linearRampToValueAtTime(1, .5);
				}
				const mono = context.createGain(); mono.channelCount = 1; mono.channelCountMode = 'explicit';
				output.connect(panner); panner.connect(mono); output = mono;
			}
			output.connect(context.destination); source.start();
			const samples = (await context.startRendering()).getChannelData(0);
			return [samples[3_000], samples[12_000], samples[21_000]];
		}, pan);
		for (const sample of expected) expect(sample).toBeGreaterThan(.03);
		const dialog = await openExportDialog(page, editor);
		await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WAV');
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		const link = dialog.locator('[data-export-download]'); await expect(link).toBeVisible();
		const file = new Blob([await readDownloadBytes(page, link)]);
		const descriptor = await inspectWavBlobPcm(file);
		expect(descriptor.channelCount).toBe(1); expect(descriptor.frameCount).toBe(source.frameCount);
		const samples = (await createWavBlobPcmChunkReader(file, { descriptor }).readChunk(0)).channels[0];
		for (const [index, frame] of [3_000, 12_000, 21_000].entries()) expect(samples[frame]).toBeCloseTo(expected[index], 5);
	});
}
