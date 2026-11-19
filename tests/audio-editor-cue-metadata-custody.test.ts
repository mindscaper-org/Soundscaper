/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const cases = [
	...[{ quoted: false, title: "'97" }, { quoted: false, title: "'" }, { quoted: true, title: "'97" }].map(({ quoted, title }) => ({
		name: `${quoted ? 'quoted' : 'bare'} ${title}`,
		bytes: Buffer.from(`FILE Programme.wav WAVE\nTRACK 01 AUDIO\n TITLE ${quoted ? `"${title}"` : title}\n INDEX 01 00:00:01\n`),
		labels: [{ title, startFrame: 640, endFrame: 640 }],
	})),
	{ name: 'Windows-1252 production titles', bytes: Buffer.from('TITLE "Frühlingskonzert"\r\nPERFORMER "René Müller"\r\nFILE "concert.wav" WAVE\r\n  TRACK 01 AUDIO\r\n    TITLE "Ouvertüre"\r\n    INDEX 01 00:00:00\r\n  TRACK 02 AUDIO\r\n    TITLE "Straße zum Café"\r\n    INDEX 01 00:01:00\r\n', 'latin1'),
		labels: [{ title: 'Ouvertüre', startFrame: 0, endFrame: 0 }, { title: 'Straße zum Café', startFrame: 48_000, endFrame: 48_000 }] },
	{ name: 'K3b empty title fallback', bytes: Buffer.from('REM Cue file written by K3b\n\nPERFORMER "Presenter"\nTITLE ""\nFILE "Programme.wav" WAVE\n  TRACK 01 AUDIO\n    PERFORMER "Presenter"\n    TITLE ""\n    INDEX 01 00:00:00\n  TRACK 02 AUDIO\n    PERFORMER ""\n    TITLE "Interview"\n    INDEX 01 00:00:20\n'),
		labels: [{ title: 'Track 01', startFrame: 0, endFrame: 0 }, { title: 'Interview', startFrame: 12_800, endFrame: 12_800 }] },
];

for (const fixture of cases) test(`CUE ${fixture.name} retains exact label text and frames through independent Scape reopening`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	// Exercise production stores against independent fixture IndexedDB APIs.
	const sender = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
	const recipient = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store: sender,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), engine: createMemoryEngine() as unknown as Options['engine'] });
	context.after(async () => { await controller.dispose(); await recipient.close(); });
	await controller.ready;
	const imported = await controller.actions.labels.importCueFile(new File([fixture.bytes], 'Programme.cue', { type: 'application/x-cue' }), 'labels');
	assert.equal(imported?.count, fixture.labels.length);
	controller.actions.edit.undo();
	assert.equal(controller.project?.tracks.some(track => track.type === 'label'), false);
	controller.actions.edit.redo();
	const project: unknown = controller.project; assert.ok(validateSoundscaperProject(project));
	const archive = createSoundscaperScapeNativeRuntime();
	const exported = await archive.exportScapeProject(project, sender); assert.ok(exported.blob);
	const reopened = await archive.importScapeProject(exported.blob, recipient);
	assert.equal(reopened.readOnly, false);
	const restored: unknown = reopened.project; assert.ok(validateSoundscaperProject(restored));
	assert.equal(restored.sources.length, 0);
	const labels = restored.tracks.flatMap(track => track.type === 'label' ? track.labels : []);
	assert.deepEqual(labels.map(({ title, startFrame, endFrame }) => ({ title, startFrame, endFrame })), fixture.labels);
});
