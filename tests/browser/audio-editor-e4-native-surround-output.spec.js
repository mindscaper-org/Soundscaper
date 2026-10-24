/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { installNativeOutputPeer } from './helpers/native-output-peer.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const defaultWidth of [2, 6]) for (const signalChannel of [0, 2]) {
	test(`native stereo preserves 5.1 channel ${signalChannel} with default hardware width ${defaultWidth}`, async ({ page, browserName }) => {
		test.skip(browserName !== 'chromium', 'Native audio hosts run in the maintained Electron renderer (Chromium).');
		await installNativeOutputPeer(page);
		if (defaultWidth === 6) await installSurroundDefaultHardware(page);
		const { project, blob } = await archive(defaultWidth, signalChannel);
		const editor = await bootEditor(page, '/embed/en/');
		await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Surround.sscape', mimeType: 'application/zip',
			buffer: Buffer.from(await blob.arrayBuffer()) });
		await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Audio settings$/u }).click();
		await preferences.getByRole('combobox', { name: 'Host', exact: true }).selectOption('alsa');
		await expect(preferences.getByRole('combobox', { name: 'Speakers', exact: true })).toContainText('Chosen native speakers');
		await expect(preferences.getByRole('alert')).toHaveCount(0);
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		const expected = signalChannel === 2 ? [.25 * Math.SQRT1_2 * .5, .25 * Math.SQRT1_2 * .5] : [.125, 0];
		await expect.poll(() => page.evaluate(() => window.__nativeOutput.channelMeans)).toEqual(expected.map(Math.fround));
		const sequence = await page.evaluate(() => window.__nativeOutput.packets);
		await expect.poll(() => page.evaluate(() => window.__nativeOutput.packets)).toBeGreaterThan(sequence + 32);
		expect(await page.evaluate(() => window.__nativeOutput.loss)).toEqual([]);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	});
}

for (const nativeWidth of [1, 2]) for (const programmeWidth of [2, 6]) {
	test(`native width ${nativeWidth} retains programme ${programmeWidth} off-left audio`, async ({ page, browserName }) => {
		test.skip(browserName !== 'chromium', 'Native audio hosts run in the maintained Electron renderer (Chromium).');
		await installNativeOutputPeer(page, { outputChannelCount: nativeWidth });
		const { project, blob } = await archive(2, programmeWidth === 2 ? 1 : 2, programmeWidth);
		const editor = await bootEditor(page, '/embed/en/');
		await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Right.sscape', mimeType: 'application/zip',
			buffer: Buffer.from(await blob.arrayBuffer()) });
		await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Audio settings$/u }).click();
		await preferences.getByRole('combobox', { name: 'Host', exact: true }).selectOption('alsa');
		await expect(preferences.getByRole('combobox', { name: 'Speakers', exact: true })).toContainText('Chosen native speakers');
		await expect(preferences.getByRole('alert')).toHaveCount(0);
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		const expected = programmeWidth === 2 ? (nativeWidth === 1 ? [.125] : [0, .25])
			: Array(nativeWidth).fill(.25 * Math.SQRT1_2 * .5);
		await expect.poll(() => page.evaluate(expected => {
			const actual = window.__nativeOutput.channelMeans;
			return actual.length === expected.length ? Math.max(...actual.map((sample, index) => Math.abs(sample - expected[index]))) : Infinity;
		}, expected)).toBeLessThan(1e-7);
		const sequence = await page.evaluate(() => window.__nativeOutput.packets);
		await expect.poll(() => page.evaluate(() => window.__nativeOutput.packets)).toBeGreaterThan(sequence + 32);
		expect(await page.evaluate(() => window.__nativeOutput.loss)).toEqual([]);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	});
}

/** Represent a separate capable default device; the selected native output remains stereo.
 * Web Audio permits channelCount up to that physical endpoint's maxChannelCount:
 * https://www.w3.org/TR/webaudio/#dom-audiodestinationnode-maxchannelcount
 * Every programme buffer, graph node, native worklet and port still processes real PCM.
 */
async function installSurroundDefaultHardware(page) {
	await page.addInitScript(() => {
		const counts = new WeakMap(), descriptor = Object.getOwnPropertyDescriptor(AudioNode.prototype, 'channelCount');
		Object.defineProperty(AudioDestinationNode.prototype, 'maxChannelCount', { configurable: true, get() { return 6; } });
		Object.defineProperty(AudioDestinationNode.prototype, 'channelCount', {
			configurable: true, get() { return counts.get(this) ?? descriptor.get.call(this); },
			set(value) {
				if (value === 6) counts.set(this, value);
				else { counts.delete(this); descriptor.set.call(this, value); }
			},
		});
	});
}

async function archive(defaultWidth, signalChannel, programmeWidth = 6) {
	const source = createAudioSource({ id: 'surround', sampleRate: 48_000, frameCount: 48_000 * 8, channelCount: programmeWidth });
	const clip = createAudioClip({ id: 'surround-clip', sourceId: source.id, durationFrames: source.frameCount,
		sourceDurationFrames: source.frameCount, fadeInFrames: 0, fadeOutFrames: 0 });
	const project = createSoundscaperProject({ id: `native-surround-${defaultWidth}-${signalChannel}`, sampleRate: 48_000,
		masterChannels: programmeWidth, sources: [source], clips: [clip], tracks: [createAudioTrack({ id: 'surround', clipIds: [clip.id] })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		for (let offset = 0; offset < source.frameCount; offset += source.chunkFrames) {
			await writer.write(Array.from({ length: programmeWidth }, (_, channel) => new Float32Array(Math.min(source.chunkFrames, source.frameCount - offset))
				.fill(channel === signalChannel ? .25 : 0)));
		}
		await writer.commit();
		const { blob } = await exportScapeProject(project, store); expect(blob).toBeTruthy(); return { project, blob };
	} finally { await store.close(); }
}
