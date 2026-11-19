/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

async function burstProject(wet, beforeGap) {
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 96_000, channelCount: 1 });
	const project = createSoundscaperProject({ id: `cut-wet-${wet}-${beforeGap}`, sampleRate: 48_000, sources: [source],
		clips: [createAudioClip({ id: 'clip', title: 'Burst', sourceId: source.id, durationFrames: 96_000, sourceDurationFrames: 96_000 })],
		tracks: [createAudioTrack({ id: 'track', name: 'Programme', clipIds: ['clip'], effects: wet
			? [{ id: 'echo', type: 'delay', enabled: true, params: { mix: 1, time: .5, feedback: 0 } }] : [] })],
		selection: { startFrame: 24_000, endFrame: 48_000, trackIds: ['track'], clipIds: [] } });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		const burstStart = beforeGap ? 12_000 : 36_000;
		for (let offset = 0; offset < 96_000; offset += source.chunkFrames) {
			await writer.write([Float32Array.from({ length: Math.min(source.chunkFrames, 96_000 - offset) }, (_, index) => {
				const frame = offset + index;
				return frame >= burstStart && frame < burstStart + 2_400 ? .25 * Math.sin(2 * Math.PI * 512 * frame / 48_000) : 0;
			})]);
		}
		await writer.commit();
		return { project, blob: (await exportScapeProject(project, store)).blob };
	} finally { await store.close(); }
}

for (const [wet, beforeGap] of [[false, false], [true, false], [true, true]]) {
	test(`Cut Preview matches actual Cut then WAV with wet=${wet}, retained burst=${beforeGap}`, async ({ page }) => {
		await page.addInitScript(() => {
			globalThis.__cutPreviewBuffers = [];
			const start = AudioBufferSourceNode.prototype.start;
			AudioBufferSourceNode.prototype.start = function (...args) {
				if (this.context instanceof AudioContext && this.buffer) {
					globalThis.__cutPreviewBuffers.push(Array.from(this.buffer.getChannelData(0)));
				}
				return Reflect.apply(start, this, args);
			};
		});
		const { project, blob } = await burstProject(wet, beforeGap);
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
		await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Burst.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
		await expect(editor).toHaveAttribute('data-project-id', project.id);
		await waitForProjectActivation(editor);
		const programme = await exportSamples(page, editor);
		expect(programme.some(sample => Math.abs(sample) > .1), 'the original programme has a real audible burst').toBe(true);
		await editor.getByRole('button', { name: 'Play options', exact: true }).click();
		await page.getByRole('menu', { name: 'Play options', exact: true }).getByRole('menuitem', { name: 'Cut preview', exact: true }).click();
		await expect.poll(() => page.evaluate(() => globalThis.__cutPreviewBuffers.length)).toBeGreaterThan(0);
		const preview = await page.evaluate(() => globalThis.__cutPreviewBuffers.at(-1));
		expect(preview.length).toBe(72_000);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		await chooseNestedCommandAction(page, editor, 'Edit', ['Cut', 'Cut']);
		const cut = await exportSamples(page, editor);
		const cutPeak = cut.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
		const previewPeak = preview.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
		if (beforeGap) {
			expect(cutPeak).toBeGreaterThan(.1);
			expect(previewPeak, 'retained input must keep driving the delay across the cut').toBeGreaterThan(.1);
		} else {
			expect(cutPeak).toBeLessThan(1e-6);
			expect(previewPeak, 'removed input must not leak through wet history').toBeLessThan(1e-6);
		}
		const difference = preview.reduce((maximum, sample, frame) => Math.max(maximum, Math.abs(sample - cut[frame])), 0);
		expect(difference, 'native preview PCM must match the actual edit, allowing only WAV quantization and dither').toBeLessThan(1e-6);
	});
}
