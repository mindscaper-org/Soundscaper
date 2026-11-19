/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject, SCAPE_MIME_TYPE } from '../../src/common/editor/scape-project.js';

async function archives() {
	const store = createProjectStore({ databaseName: `browser-take-preview-${crypto.randomUUID()}`, indexedDB: null, preferOpfs: false });
	try {
		const source = createAudioSource({ id: 'take-source', storageKey: 'take-source', name: 'Take', frameCount: 480_000, channelCount: 1, sampleRate: 48_000 });
		const writer = await store.beginSourceWrite(source.id, source);
		for (let frame = 0; frame < 480_000; frame += 65_536) await writer.write([new Float32Array(Math.min(65_536, 480_000 - frame)).fill(0.25)]);
		await writer.commit();
		const outgoing = createSoundscaperProject({ id: 'outgoing-take-preview', sources: [source],
			tracks: [createAudioTrack({ id: 'vocal', name: 'Vocal', clipIds: [] })],
			sequences: [{ id: 'main', trackIds: ['vocal'] }], primarySequenceId: 'main',
			takeGroups: [{ id: 'group', sequenceId: 'main', trackId: 'vocal', startSample: 0, endSample: 480_000,
				laneOrder: ['lane'], lanes: [{ id: 'lane' }],
				takes: [{ id: 'take', laneId: 'lane', sourceId: source.id, startSample: 0, endSample: 480_000, sourceStartSample: 0 }],
				compRegions: [{ id: 'region', takeId: 'take', startSample: 0, endSample: 480_000 }] }] });
		const result = [];
		for (const project of [outgoing, createSoundscaperProject({ id: 'incoming-take-preview' })]) {
			const archive = await exportScapeProject(project, store); expect(archive.blob).toBeInstanceOf(Blob);
			result.push(Buffer.from(await archive.blob.arrayBuffer()).toString('base64'));
		}
		return result;
	} finally {
		try { await store.clear(); }
		finally { await store.close(); }
	}
}

for (const operation of ['open-project', 'remove-group']) test(`${operation} stops audio from the open Take Comp audition dialog`, async ({ page }) => {
	await page.addInitScript(() => {
		globalThis.__takePreviewSources = [];
		Object.defineProperty(globalThis, 'launchQueue', { configurable: true,
			value: { setConsumer(consumer) { globalThis.__takePreviewLaunch = consumer; } } });
		const start = AudioBufferSourceNode.prototype.start, stop = AudioBufferSourceNode.prototype.stop;
		AudioBufferSourceNode.prototype.start = function (...args) { globalThis.__takePreviewSources.push(this); return Reflect.apply(start, this, args); };
		AudioBufferSourceNode.prototype.stop = function (...args) { this.__takeRetired = true; return Reflect.apply(stop, this, args); };
		const Worklet = AudioWorkletNode;
		globalThis.AudioWorkletNode = new Proxy(Worklet, { construct(target, args) {
			const node = Reflect.construct(target, args);
			if (args[1] === 'kw-audio-chunk-stream') globalThis.__takePreviewSources.push(node);
			return node;
		} });
		const disconnect = AudioNode.prototype.disconnect;
		AudioNode.prototype.disconnect = function (...args) { this.__takeRetired = true; return Reflect.apply(disconnect, this, args); };
	});
	const editor = await bootEditor(page, '/en/'); const [outgoing, incoming] = await archives();
	const launch = async bytes => page.evaluate(({ content, type }) => {
		globalThis.__takePreviewLaunch({ files: [{ kind: 'file', getFile: () => Promise.resolve(
			new File([Uint8Array.from(atob(content), character => character.charCodeAt(0))], 'programme.sscape', { type })) }] });
	}, { content: bytes, type: SCAPE_MIME_TYPE });
	await launch(outgoing); await expect(editor).toHaveAttribute('data-project-id', 'outgoing-take-preview');
	await editor.locator('[data-track-row] .track-control-panel__track-name-text').click();
	await chooseTrackMenuAction(page, editor, null, 'Take lanes and comps');
	const dialog = page.getByRole('dialog', { name: 'Take lanes and comps', exact: true });
	await page.evaluate(() => { globalThis.__takePreviewSources = []; });
	await dialog.getByRole('button', { name: 'Audition Take', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__takePreviewSources.length)).toBeGreaterThan(0);
	if (operation === 'open-project') {
		await launch(incoming); await expect(editor).toHaveAttribute('data-project-id', 'incoming-take-preview');
	} else {
		await dialog.getByRole('button', { name: 'Remove take group', exact: true }).click();
		await expect(dialog.locator('[data-take-comp-empty]')).toBeVisible();
		await expect(dialog.getByRole('button', { name: 'Audition Take', exact: true })).toHaveCount(0);
	}
	await expect.poll(() => page.evaluate(() => globalThis.__takePreviewSources.every(source => source.__takeRetired === true))).toBe(true);
});
