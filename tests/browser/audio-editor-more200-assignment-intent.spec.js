/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, disableNativeSavePicker, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

test('native mono and stereo assignment paths retain their programme through selection and Mix & Render', async ({ page }) => {
	const profiles = [false, true, 'send-only'].flatMap(custom => [1, 2].map(channelCount => ({ custom, channelCount })));
	const sources = profiles.map(({ channelCount }, index) => createAudioSource({ id: `source-${index}`, sampleRate: 48_000, frameCount: 4800, channelCount }));
	const base = createSoundscaperProject({ id: 'assignment-paths', sources,
		clips: sources.map((source, index) => createAudioClip({ id: `clip-${index}`, sourceId: source.id, title: `Voice ${index}`,
			timelineStartFrame: index * 4800, durationFrames: 4800, sourceDurationFrames: 4800 })),
		tracks: sources.map((_, index) => createAudioTrack({ id: `voice-${index}`, name: `Voice ${index}`, clipIds: [`clip-${index}`] })) });
	const send = { id: 'wet', name: 'Wet', color: '#456789', gain: 1, pan: 0, mute: false, solo: false,
		collapsed: false, effectsActive: true, effects: [], channelCount: 2 };
	const edges = base.mixer.edges.map(edge => {
		if (edge.source.kind !== 'track') return edge;
		const index = Number(edge.source.id.replace('voice-', '')), { custom } = profiles[index];
		return { ...edge, id: custom ? `reviewed-voice-output-${index}` : edge.id, level: .4,
			...(custom === 'send-only' ? { kind: 'send', destination: { kind: 'mixer-node', id: send.id } } : {}) };
	});
	edges.push({ id: 'wet-output', kind: 'assignment', source: { kind: 'mixer-node', id: send.id }, destination: { kind: 'master' },
		position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] });
	const project = createSoundscaperProject({ ...base, mixer: { ...base.mixer, sends: [send], edges } });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() }); let file;
	try {
		for (const source of sources) {
			const writer = await store.beginSourceWrite(source.storageKey, source);
			await writer.write(Array.from({ length: source.channelCount }, (_, channel) => new Float32Array(4800).fill(channel ? -.125 : .25)));
			await writer.commit();
		}
		const archive = await exportScapeProject(project, store); expect(archive.blob).toBeInstanceOf(Blob);
		file = { name: 'Assignment.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) };
	} finally { await store.close(); }
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles(file);
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	assertProgramme(await exportSamples(page, editor));
	await editor.locator('[data-clip-id="clip-5"] .clip-header').click();
	await expect(editor.locator('[data-clip-id="clip-5"] .clip-display--selected')).toBeVisible();
	assertProgramme(await exportSamples(page, editor));
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Mix & Render']);
	const dialog = page.getByRole('dialog', { name: 'Mix & Render', exact: true });
	await dialog.getByRole('button', { name: 'Mix & Render', exact: true }).click();
	await expect(dialog).toBeHidden();
	for (let index = 0; index < profiles.length; index++) await expect(editor.locator(`[data-clip-id="clip-${index}"]`)).toHaveCount(0);
	assertProgramme(await exportSamples(page, editor));

	function assertProgramme(samples) {
		expect(samples).toHaveLength(4800 * profiles.length);
		for (const [index, profile] of profiles.entries()) {
			const expected = .25 * .4 * (profile.channelCount === 1 ? Math.SQRT1_2 : 1);
			let error = 0;
			// New-clip microfades are existing edit policy; compare each unchanged interior.
			for (let frame = 256; frame < 4544; frame++) error = Math.max(error, Math.abs(samples[index * 4800 + frame] - expected));
			expect(error, JSON.stringify(profile)).toBeLessThan(.00001);
		}
	}
});
