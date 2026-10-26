/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const custom of [false, true, 'send-only']) for (const channelCount of [1, 2]) test(`native programme assignment retains its audio through selection and Mix & Render (custom=${custom}, channels=${channelCount})`, async ({ page }) => {
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 4800, channelCount });
	const base = createSoundscaperProject({ id: `assignment-${custom}-${channelCount}`, sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, title: 'Voice recording', durationFrames: 4800, sourceDurationFrames: 4800 })],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] })] });
	const sendOnly = custom === 'send-only';
	const send = { id: 'wet', name: 'Wet', color: '#456789', gain: 1, pan: 0, mute: false, solo: false,
		collapsed: false, effectsActive: true, effects: [], channelCount: 2 };
	const edges = base.mixer.edges.map(edge => edge.source.kind === 'track' ? { ...edge, id: custom ? 'reviewed-voice-output' : edge.id,
		level: .4, ...(sendOnly ? { kind: 'send', destination: { kind: 'mixer-node', id: send.id } } : {}) } : edge);
	if (sendOnly) edges.push({ id: 'wet-output', kind: 'assignment', source: { kind: 'mixer-node', id: send.id }, destination: { kind: 'master' },
		position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] });
	const project = createSoundscaperProject({ ...base, mixer: { ...base.mixer, sends: sendOnly ? [send] : [], edges } });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() }); let file;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write(Array.from({ length: channelCount }, (_, channel) => new Float32Array(4800).fill(channel ? -.125 : .25))); await writer.commit();
		const archive = await exportScapeProject(project, store); expect(archive.blob).toBeInstanceOf(Blob);
		file = { name: 'Assignment.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) };
	} finally { await store.close(); }
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles(file);
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	const before = await exportSamples(page, editor); expect(before).toHaveLength(4800); expect(Math.abs(before[2000])).toBeGreaterThan(.05);
	await editor.locator('[data-clip-id="clip"] .clip-header').click();
	await expect(editor.locator('[data-clip-id="clip"] .clip-display--selected')).toBeVisible();
	const selected = await exportSamples(page, editor);
	expect(Math.max(...selected.map((sample, frame) => Math.abs(sample - before[frame])))).toBeLessThan(.00001);
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Mix & Render']);
	const dialog = page.getByRole('dialog', { name: 'Mix & Render', exact: true });
	await dialog.getByRole('button', { name: 'Mix & Render', exact: true }).click();
	await expect(dialog).toBeHidden(); await expect(editor.locator('[data-clip-id="clip"]')).toHaveCount(0);
	const rendered = await exportSamples(page, editor); expect(rendered).toHaveLength(before.length);
	// New clip microfades are existing edit policy; compare its unchanged interior programme.
	expect(Math.max(...rendered.slice(256, -256).map((sample, frame) => Math.abs(sample - before[frame + 256])))).toBeLessThan(.00001);
});
