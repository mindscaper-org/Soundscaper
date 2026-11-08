/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { installNativeOutputPeer, NATIVE_OUTPUT_PEER_WEBKIT_REASON } from './helpers/native-output-peer.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

async function echoProgramme() {
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 240_000, channelCount: 1 });
	const project = createSoundscaperProject({ id: 'live-mixer-echo', sampleRate: 48_000, sources: [source],
		clips: [createAudioClip({ id: 'clip', title: 'Burst', sourceId: source.id, durationFrames: 240_000, sourceDurationFrames: 240_000 })],
		tracks: [createAudioTrack({ id: 'track', name: 'Programme', clipIds: ['clip'], effects: [
			{ id: 'echo', type: 'delay', enabled: true, params: { mix: 1, time: 2, feedback: 0 } },
		] })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		for (let offset = 0; offset < source.frameCount; offset += source.chunkFrames) {
			await writer.write([Float32Array.from({ length: Math.min(source.chunkFrames, source.frameCount - offset) }, (_, index) => {
				const frame = offset + index;
				return frame >= 9_600 && frame < 12_000 ? .25 * Math.sin(2 * Math.PI * 512 * frame / 48_000) : 0;
			})]);
		}
		await writer.commit();
		return { project, blob: (await exportScapeProject(project, store)).blob };
	} finally { await store.close(); }
}

for (const gesture of ['keyboard', 'pointer']) for (const when of ['before', 'during']) {
	test(`${gesture} mixer commit ${when} playback retains the already-entered echo`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', NATIVE_OUTPUT_PEER_WEBKIT_REASON);
		await installNativeOutputPeer(page);
		await page.addInitScript(() => {
			globalThis.__mixerProgrammeStarts = []; globalThis.__mixerProgrammePackets = [];
			const start = AudioBufferSourceNode.prototype.start;
			AudioBufferSourceNode.prototype.start = function (...args) {
				if (this.context instanceof AudioContext) globalThis.__mixerProgrammeStarts.push({
					time: args[0] ?? this.context.currentTime, context: this.context,
				});
				return Reflect.apply(start, this, args);
			};
		});
		const { project, blob } = await echoProgramme();
		const editor = await bootEditor(page, '/embed/en/');
		await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Echo.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
		await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
		await editor.getByRole('button', { name: 'Audio setup', exact: true }).click();
		const setup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
		await setup.getByRole('combobox', { name: 'Host', exact: true }).selectOption('alsa');
		await expect(setup.getByRole('combobox', { name: 'Speakers', exact: true })).toBeEnabled(); await page.keyboard.press('Escape');
		await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
		const fader = editor.locator('.kw-audio-editor__mixer-channel--track').getByRole('slider', { name: /volume$/u });
		const changeGain = async () => {
			await expect(fader).toBeEnabled(); const before = await fader.getAttribute('aria-valuenow');
			if (gesture === 'keyboard') await fader.press('ArrowDown');
			else {
				const box = await fader.locator('.mixer-fader__handle').boundingBox(); expect(box).not.toBeNull();
				const x = box.x + box.width / 2, y = box.y + box.height / 2;
				await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y + 2, { steps: 2 }); await page.mouse.up();
			}
			await expect(fader).not.toHaveAttribute('aria-valuenow', before);
		};
		if (when === 'before') await changeGain();
		await page.evaluate(() => {
			const history = globalThis.__nativeOutput.packetHistory, push = history.push;
			history.push = function (...packets) { globalThis.__mixerProgrammePackets.push(...packets); return Reflect.apply(push, this, packets); };
		});
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		const elapsed = () => page.evaluate(() => {
			const source = globalThis.__mixerProgrammeStarts[0]; return source ? source.context.currentTime - source.time : 0;
		});
		await expect.poll(elapsed, { intervals: [20] }).toBeGreaterThan(.6);
		if (when === 'during') await changeGain();
		await expect.poll(elapsed, { intervals: [20] }).toBeGreaterThan(3);
		const actual = await page.evaluate(() => ({ starts: globalThis.__mixerProgrammeStarts.length,
			peak: Math.max(0, ...globalThis.__mixerProgrammePackets.flatMap(packet => packet.peaks)),
		}));
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		expect(actual.peak, 'the native output must retain the echo from the earlier50ms burst').toBeGreaterThan(.1);
		expect(actual.starts, 'an adopted live scalar must retain the same processor graph').toBe(1);
	});
}
