/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { createEffect } from '../../src/common/editor/effects.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const removed of ['old-control', 'actual-control']) {
	test(`Remove tracks preserves the authored Auto Duck detector when deleting ${removed}`, async ({ page }) => {
		const source = createAudioSource({ id: 'tone', frameCount: 48_000, sampleRate: 48_000, channelCount: 1 });
		const names = ['programme', 'old-control', 'actual-control'];
		const effect = createEffect('audacity-auto-duck', { id: 'duck', context: { controlTrackId: 'old-control' },
			params: { outerFadeDown: 0, outerFadeUp: 0 } });
		const base = createSoundscaperProject({ id: `detector-removal-${removed}`, sources: [source],
			tracks: names.map(id => createAudioTrack({ id, name: id, gain: id === 'programme' ? 1 : 0,
				clipIds: [`${id}-clip`], effects: id === 'programme' ? [effect] : [] })),
			clips: names.map(id => createAudioClip({ id: `${id}-clip`, title: id, sourceId: source.id,
				durationFrames: source.frameCount, sourceDurationFrames: source.frameCount })) });
		const project = createSoundscaperProject({ ...base, mixer: { ...base.mixer, edges: [...base.mixer.edges,
			{ id: 'detector', kind: 'sidechain', source: { kind: 'track', id: 'actual-control' },
				destination: { kind: 'effect-sidechain', strip: { kind: 'track', id: 'programme' }, effectId: effect.id },
				position: 'pre-fader', level: 1, enabled: true, channelMap: [0] }] } });
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: project.id });
		let blob;
		try {
			const writer = await store.beginSourceWrite(source.storageKey, source);
			await writer.write([new Float32Array(source.frameCount).fill(.1)]); await writer.commit();
			blob = (await exportScapeProject(project, store)).blob;
		} finally { await store.close(); }
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/');
		await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Advanced detector.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
		await expect(editor).toHaveAttribute('data-project-id', project.id);
		const wet = await exportSamples(page, editor);
		expect(wet[24_000]).toBeCloseTo(.1 * Math.SQRT1_2 * 10 ** (-12 / 20), 5);
		await editor.locator(`[data-track-row][data-track-id="${removed}"] .track-control-panel__track-name-text`).click();
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Remove tracks']);
		await expect(editor.locator('[data-track-row]')).toHaveCount(2);
		const after = await exportSamples(page, editor);
		expect(after[24_000]).toBeCloseTo(removed === 'old-control' ? wet[24_000] : .1 * Math.SQRT1_2, 5);
		await chooseNestedCommandAction(page, editor, 'Edit', ['Undo']);
		await expect(editor.locator('[data-track-row]')).toHaveCount(3);
		const undone = await exportSamples(page, editor);
		expect(undone[24_000]).toBeCloseTo(wet[24_000], 5);
	});
}
