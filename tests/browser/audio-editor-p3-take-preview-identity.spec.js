/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const mode of ['take', 'lane']) test(`auditioning another group loads its ${mode} PCM when native identities contain colons`, async ({ page, browserName }) => {
	if (browserName === 'firefox') {
		await page.setContent('<button>Check native audio output</button>');
		await page.evaluate(bytes => {
			globalThis.__p3NativeOutput = new Promise((resolve, reject) => {
				document.querySelector('button').onclick = () => {
					const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'audio/wav' })); const audio = new Audio(url);
					const finish = value => { resolve(value); audio.pause(); audio.removeAttribute('src'); URL.revokeObjectURL(url); };
					audio.addEventListener('error', () => finish(audio.error?.message ?? 'Unknown native media error'), { once: true });
					audio.addEventListener('timeupdate', () => { if (audio.currentTime > .05) finish(null); });
					void audio.play().catch(reject);
				};
			});
		}, [...createWavFixture({ name: 'native-output.wav', frequency: 440, duration: 1, channelCount: 1 }).buffer]);
		await page.getByRole('button', { name: 'Check native audio output' }).click();
		const nativeError = await page.evaluate(() => globalThis.__p3NativeOutput);
		test.skip(nativeError?.includes('OnMediaSinkAudioError'), 'Independent native PCM output is unavailable in this Firefox host.'); expect(nativeError).toBeNull();
	}
	await page.addInitScript(() => {
		globalThis.__p3TakePcm = [];
		const start = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function (...args) {
			if (this.buffer?.length) globalThis.__p3TakePcm.push(this.buffer.getChannelData(0)[0]);
			return Reflect.apply(start, this, args);
		};
	});
	const frames = 240_000, groupIds = ['a:b', 'a'], memberIds = ['c', 'b:c'];
	const laneIds = mode === 'lane' ? memberIds : ['lane-first', 'lane-second'];
	const takeIds = mode === 'take' ? memberIds : ['take-first', 'take-second'];
	const sources = ['First', 'Second'].map((name, index) => createAudioSource({ id: `source-${index}`, name, frameCount: frames, channelCount: 1, sampleRate: 48_000 }));
	const project = createSoundscaperProject({ id: `p3-take-preview-${mode}`, sources,
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [] })], sequences: [{ id: 'main', trackIds: ['voice'] }], primarySequenceId: 'main',
		takeGroups: groupIds.map((id, index) => ({ id, sequenceId: 'main', trackId: 'voice', startSample: index * frames, endSample: (index + 1) * frames,
			laneOrder: [laneIds[index]], lanes: [{ id: laneIds[index] }], takes: [{ id: takeIds[index], laneId: laneIds[index], sourceId: sources[index].id,
				startSample: index * frames, endSample: (index + 1) * frames, sourceStartSample: 0 }], compRegions: [],
		})),
	});
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() }); let file;
	try {
		for (const [index, source] of sources.entries()) {
			const writer = await store.beginSourceWrite(source.storageKey, source);
			for (let offset = 0; offset < frames; offset += 65_536) await writer.write([new Float32Array(Math.min(65_536, frames - offset)).fill(index ? -.5 : .125)]);
			await writer.commit();
		}
		const archive = await exportScapeProject(project, store); expect(archive.blob).toBeInstanceOf(Blob);
		file = { name: 'Takes.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) };
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/'); await editor.locator('[data-aup4-input]').setInputFiles(file);
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	await chooseTrackMenuAction(page, editor, null, 'Take lanes and comps');
	const dialog = page.getByRole('dialog', { name: 'Take lanes and comps', exact: true });
	await dialog.locator('[data-take-comp-group]').selectOption(groupIds[0]);
	await dialog.getByRole('button', { name: mode === 'take' ? 'Audition First' : 'Audition lane', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__p3TakePcm.includes(.125))).toBe(true);
	await dialog.locator('[data-take-comp-group]').selectOption(groupIds[1]);
	await dialog.getByRole('button', { name: mode === 'take' ? 'Audition Second' : 'Audition lane', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__p3TakePcm.includes(-.5))).toBe(true);
});
