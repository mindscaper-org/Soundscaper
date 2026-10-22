/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, openExportDialog } from './audio-editor-test-helpers.js';
import { mixDetectorProject } from '../helpers/next-mix-detector-project.ts';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const enabled of [true, false]) test(`native cross-sequence detector export refuses only an enabled dependency (${enabled})`, async ({ page }) => {
	const { project: base, sources, channels } = mixDetectorProject('track', enabled);
	const project = createSoundscaperProject({ ...base, id: `cross-sequence-detector-${String(enabled)}`,
		primarySequenceId: 'main', sequences: [{ id: 'main', trackIds: ['voice'] }, { id: 'other', trackIds: ['control'] }] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: project.id });
	let blob;
	try {
		for (const source of sources) {
			const writer = await store.beginSourceWrite(source.storageKey, source);
			await writer.write(channels.get(source.id)); await writer.commit();
		}
		blob = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Detector programme.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	if (enabled) {
		const dialog = await openExportDialog(page, editor);
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		await expect(editor.getByRole('alert')).toContainText('Move its detector recording into the delivered timeline');
		await expect(dialog.locator('[data-export-download]')).toBeHidden();
	} else {
		const samples = await exportSamples(page, editor);
		expect(samples.length).toBe(48_000);
		expect(samples[24_000]).toBeCloseTo(.25 * Math.SQRT1_2, 5);
	}
});

test('primary sequence delivery retains its quiet bus detector while excluding foreign programme', async ({ page }) => {
	const { project: base, sources, channels } = mixDetectorProject('bus', true);
	const assignment = base.mixer.edges.find(edge => edge.kind === 'assignment' && edge.source.kind === 'track' && edge.source.id === 'voice');
	expect(assignment).toBeDefined();
	const project = createSoundscaperProject({ ...base, id: 'within-sequence-detector',
		primarySequenceId: 'main', sequences: [{ id: 'main', trackIds: ['voice', 'control'] }, { id: 'other', trackIds: ['foreign'] }],
		tracks: [...base.tracks, createAudioTrack({ id: 'foreign', clipIds: ['foreign-clip'] })],
		clips: [...base.clips, createAudioClip({ id: 'foreign-clip', sourceId: 'voice', durationFrames: 48_000, sourceDurationFrames: 48_000 })],
		mixer: { ...base.mixer, edges: [...base.mixer.edges, { ...assignment, id: 'foreign-output', source: { kind: 'track', id: 'foreign' } }] },
	});
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: project.id });
	let blob;
	try {
		for (const source of sources) {
			const writer = await store.beginSourceWrite(source.storageKey, source);
			await writer.write(channels.get(source.id)); await writer.commit();
		}
		blob = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Bus detector.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	const samples = await exportSamples(page, editor);
	expect(samples.length).toBe(48_000);
	expect(Math.max(...samples.slice(12_000, 36_000).map(Math.abs))).toBeLessThan(.0001);
});
