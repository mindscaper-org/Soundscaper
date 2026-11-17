/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';
import { createAudioClip } from '../../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperEphemeralProjectStore } from '../../src/soundscaper/editor-project-store.ts';
import { createEnvelopeValueEvaluator } from '../../src/common/editor/automation.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

test('microphone bleed creates envelopes on beat-anchored recordings', async ({ page }) => {
	const frames = 32000, rate = 8000;
	let seed = 29, smooth = 0;
	const voice = Float32Array.from({ length: frames }, () => {
		seed = Math.imul(seed, 1664525) + 1013904223 | 0;
		smooth = .85 * smooth + .15 * seed / 2 ** 31; return smooth;
	});
	const project = createSoundscaperProject({ id: 'musical-bleed-browser', sampleRate: rate,
		sources: [0, 1].map(index => ({ id: `source-${index}`, storageKey: `source-${index}`, sampleRate: rate, frameCount: frames, channelCount: 1 })),
		clips: [0, 1].map(index => createAudioClip({ id: `clip-${index}`, sourceId: `source-${index}`,
			anchor: 'musical', musicalStartBeat: 2, musicalExtent: 'beat', musicalDurationBeats: 8, sourceDurationFrames: frames })),
		tracks: [0, 1].map(index => ({ id: `track-${index}`, type: 'audio', name: `Microphone ${index + 1}`, clipIds: [`clip-${index}`] })),
	});
	const store = createSoundscaperEphemeralProjectStore();
	let buffer;
	try {
		for (const [index, gain] of [1, .2].entries()) {
			const writer = await store.beginSourceWrite(`source-${index}`, { sampleRate: rate, channelCount: 1 });
			await writer.write([Float32Array.from(voice, sample => sample * gain)]); await writer.commit();
		}
		const archive = await exportScapeProject(project, store); buffer = Buffer.from(await archive.blob.arrayBuffer());
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Musical microphones.sscape', mimeType: 'application/zip', buffer });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Noise removal and repair', 'Automatic microphone-bleed reduction']);
	const dialog = page.getByRole('dialog', { name: 'Automatic microphone-bleed reduction', exact: true });
	await dialog.getByRole('button', { name: 'Create gain envelopes', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect.poll(async () => (await persistedProject(page, project.id)).clips[1].envelope.length).toBeGreaterThan(2);
	const changed = (await persistedProject(page, project.id)).clips[1];
	expect(changed.anchor).toBe('musical');
	expect(createEnvelopeValueEvaluator(changed.envelope, frames)(16000)).toBeLessThan(.3);
});
