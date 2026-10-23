/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, disableNativeSavePicker, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const collision of [false, true]) test(`Mix & Render preserves an unrelated native route with output ID collision=${String(collision)}`, async ({ page }) => {
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 4800, channelCount: 2 });
	const base = createSoundscaperProject({ id: `mix-route-${String(collision)}`, sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, title: 'Voice recording', durationFrames: 4800, sourceDurationFrames: 4800 })],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] }), createAudioTrack({ id: 'music', name: 'Music' })] });
	const project = createSoundscaperProject({ ...base, mixer: { ...base.mixer, edges: base.mixer.edges.map(edge => ({ ...edge,
		id: edge.source.kind === 'track' && edge.source.id === 'voice' ? 'original-voice-output'
			: collision && edge.source.kind === 'track' && edge.source.id === 'music' ? 'assignment:track:voice:master' : edge.id,
	})) } });
	const peerRoute = project.mixer.edges.find(edge => edge.source.kind === 'track' && edge.source.id === 'music');
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() }); let file;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(4800).fill(.25), new Float32Array(4800).fill(-.125)]); await writer.commit();
		const archive = await exportScapeProject(project, store); expect(archive.blob).toBeInstanceOf(Blob);
		file = { name: 'Routes.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) };
	} finally { await store.close(); }
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles(file);
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'read-only');
	const before = await exportSamples(page, editor); expect(before).toHaveLength(4800);
	await editor.locator('[data-clip-id="clip"] .clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Mix & Render']);
	const dialog = page.getByRole('dialog', { name: 'Mix & Render', exact: true });
	await dialog.getByRole('button', { name: 'Mix & Render', exact: true }).click();
	await expect(dialog).toBeHidden(); await expect(editor.locator('[data-clip-id="clip"]')).toHaveCount(0);
	const after = await exportSamples(page, editor); expect(after).toHaveLength(before.length);
	expect(after.every(Number.isFinite)).toBe(true); expect(Math.max(...after)).toBeGreaterThan(.1);
	expect(Math.max(...after.slice(256, -256).map((sample, index) => Math.abs(sample - before[index + 256])))).toBeLessThan(.00001);
	await expect.poll(async () => (await persistedProject(page, project.id))?.mixer.edges.find(edge => edge.id === peerRoute.id)).toEqual(peerRoute);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor.locator('[data-clip-id="clip"]')).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor.locator('[data-clip-id="clip"]')).toHaveCount(0);
});
