/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { strFromU8, unzipSync } from 'fflate';

for (const draft of ['13', '-61', '1e308']) test(`invalid connection gain ${draft} cannot write clamped automation during playback`, async ({ page, browserName }) => {
	if (browserName === 'firefox') {
		await page.setContent('<button>Check native audio output</button>');
		await page.evaluate(bytes => {
			globalThis.__routingNativeOutput = new Promise((resolve, reject) => {
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
		const nativeError = await page.evaluate(() => globalThis.__routingNativeOutput);
		test.skip(nativeError?.includes('OnMediaSinkAudioError'), 'Independent native PCM output is unavailable in this Firefox host.');
		expect(nativeError).toBeNull();
	}
	await disableNativeSavePicker(page);
	const source = createAudioSource({ id: 'recording', name: 'Quiet voice.wav', sampleRate: 48_000, frameCount: 480_000, channelCount: 2 });
	const base = createSoundscaperProject({ id: 'invalid-routing-automation', sources: [source],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] })],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, title: 'Voice', durationFrames: source.frameCount, sourceDurationFrames: source.frameCount })] });
	const project = createSoundscaperProject({ ...base, mixer: { ...base.mixer, edges: base.mixer.edges.map(edge => edge.id === 'assignment:track:voice:master' ? { ...edge, id: 'voice-master' } : edge) } });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	let archive;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		for (let offset = 0; offset < source.frameCount; offset += 65_536) {
			const frames = Math.min(65_536, source.frameCount - offset);
			await writer.write([new Float32Array(frames).fill(.01), new Float32Array(frames).fill(.01)]);
		}
		await writer.commit();
		archive = (await createSoundscaperScapeNativeRuntime().exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Voice.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	const row = editor.locator('[data-track-row][data-track-id="voice"]');
	await chooseTrackMenuAction(page, editor, row, 'Add automation');
	const controls = row.locator('[data-track-automation-controls]');
	await controls.getByRole('combobox', { name: 'Automation parameter', exact: true }).selectOption({ label: 'Master assignment' });
	const curve = row.locator('[data-automation-insert-point]').first();
	await curve.focus(); await curve.press('i');
	await expect(row.locator('[data-automation-point-id]')).not.toHaveCount(0);
	await controls.getByRole('combobox', { name: 'Automation mode', exact: true }).selectOption('touch');
	await chooseCommandAction(page, editor, 'Window', 'Mixer');
	const mixer = editor.locator('[data-mixer-panel]'); await mixer.getByRole('button', { name: 'Routing graph', exact: true }).click();
	const graph = mixer.locator('[data-soundscaper-routing-graph]');
	await graph.locator('[data-routing-edge="voice-master"]').click();
	const level = graph.locator('[data-routing-inspector="edge"]').getByLabel('Level (dB)', { exact: true });
	await expect(level).toBeEnabled();
	await editor.getByRole('button', { name: 'Play', exact: true }).click(); await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	await level.fill(draft); await level.press('Tab');
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const saved = JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloading))['project.json']));
	const lanes = saved.automationLanes.filter(lane => lane.address.kind === 'edge' && lane.address.edgeId === 'voice-master');
	expect(lanes).toHaveLength(1);
	expect(lanes.flatMap(lane => lane.points.map(point => point.value))).toEqual([1, 1]);
	await expect(level).toHaveValue('0');
});
