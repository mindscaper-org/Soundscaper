/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, closeDialog, collectClientErrors, commitInput, disableNativeSavePicker, openEffectsForTrack, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const mode of ['unpitched', 'dry', 'required', 'upgrade']) test(`Delay ${mode} loads only required native pitch processing`, async ({ page }) => {
	let staffpadRequests = 0;
	await page.route(/\/staffpad(?:-[^/]+)?\.wasm(?:\?.*)?$/u, async route => {
		staffpadRequests++;
		if (mode === 'upgrade') await route.continue();
		else await route.fulfill({ status: 503, body: 'Unavailable' });
	});
	await page.addInitScript(() => {
		globalThis.__delayRuntimeStarts = 0; globalThis.__delayRuntimeNativeNodes = 0;
		const original = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function (...args) {
			if (this.context instanceof AudioContext && this.buffer?.length === 48_000) globalThis.__delayRuntimeStarts++;
			return Reflect.apply(original, this, args);
		};
		const NativeNode = AudioWorkletNode;
		globalThis.AudioWorkletNode = new Proxy(NativeNode, { construct(Constructor, args) {
			if (args[1] === 'kw-standard-effect' && args[2]?.processorOptions?.staffPadWasmModule instanceof WebAssembly.Module) globalThis.__delayRuntimeNativeNodes++;
			return Reflect.construct(Constructor, args);
		} });
	});
	const source = createAudioSource({ id: 'recording', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
	const project = createSoundscaperProject({ id: `delay-runtime-${mode}`, sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 48_000, sourceDurationFrames: 48_000 })],
		loop: { enabled: mode === 'upgrade', startFrame: 0, endFrame: 48_000 },
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'], effects: [{ id: 'delay', type: 'multi-tap-delay',
			params: { time: .1, echoes: 2, echoGain: -6, pitchShift: mode === 'dry' || mode === 'required' ? 2 : 0, mix: mode === 'dry' ? 0 : 1 } }] })] });
	const input = Float32Array.from({ length: source.frameCount }, (_, index) => index < 2400 ? .25 * Math.sin(2 * Math.PI * 500 * index / 48_000) : 0);
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() }); let blob;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([input]); await writer.commit(); blob = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	const errors = mode === 'required' ? null : collectClientErrors(page); await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Delay.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	if (mode === 'required') {
		await expect(editor.locator('[data-editor-toast="workspace-error"]')).toContainText('Unable to load StaffPad WASM (503');
		expect(staffpadRequests).toBe(1);
		expect(await page.evaluate(() => globalThis.__delayRuntimeStarts)).toBe(0);
		return;
	}
	await expect.poll(() => page.evaluate(() => globalThis.__delayRuntimeStarts)).toBeGreaterThan(0);
	expect(staffpadRequests).toBe(0);
	if (mode === 'upgrade') {
		const panel = await openEffectsForTrack(editor, 0);
		await panel.getByRole('group', { name: 'Delay', exact: true }).getByRole('button', { name: 'Select effect', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: 'Delay', exact: true });
		await commitInput(dialog.getByRole('spinbutton', { name: 'Pitch shift per echo', exact: true }), '2');
		await expect.poll(() => page.evaluate(() => globalThis.__delayRuntimeNativeNodes)).toBeGreaterThan(0);
		await expect(editor.locator('[data-transport="play"]').getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		expect(staffpadRequests).toBe(1); await closeDialog(dialog);
	}
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	if (mode !== 'upgrade') {
		const actual = await exportSamples(page, editor);
		const gain = 10 ** (-6 / 20);
		let maximumError = 0;
		for (let frame = 0; frame < 48_000; frame++) {
			const echo = mode === 'dry' ? 0 : (input[frame - 4800] ?? 0) * gain + (input[frame - 9600] ?? 0) * gain ** 2;
			maximumError = Math.max(maximumError, Math.abs(actual[frame] - (input[frame] + echo) * Math.SQRT1_2));
		}
		expect(maximumError).toBeLessThan(.0001); expect(staffpadRequests).toBe(0);
	}
	expect(errors).toEqual([]);
});
