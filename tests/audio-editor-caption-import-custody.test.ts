/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { framescaperCaptionCustody } from './helpers/framescaper-caption-custody.ts';

const SRT = '1\r\n00:00:00,100 --> 00:00:00,500\r\nÉlodie au café\r\n\r\n';

for (const encoding of ['utf8', 'latin1'] as const) test(`caption sidecar ${encoding} retains literal Unicode and clocks through controller, Scape and SRT export`, async context => {
	const result = await framescaperCaptionCustody(context, new File([Uint8Array.from(Buffer.from(SRT, encoding))], 'dialogue.srt'));
	assert.deepEqual(result.losses, []);
	assert.deepEqual(result.track.cues.map(cue => [cue.text, cue.startFrame, cue.endFrame]), [['Élodie au café', 4800, 24_000]]);
	const saved = await result.sidecar('srt');
	assert.equal(saved.file.name, 'captions.srt');
	assert.ok(saved.text.includes('Élodie au café'));
	assert.deepEqual(saved.restored.cues.map(cue => [cue.text, cue.startFrame, cue.endFrame]), [['Élodie au café', 4800, 24_000]]);
});

for (const closed of [false, true]) test(`WebVTT closed voice=${closed} retains speaker, emphasis and literal clocks through independent archive and sidecar reopening`, async context => {
	const text = `WEBVTT\r\n\r\n00:00:01.000 --> 00:00:03.000\r\n<v John><i>Thinking about the interview.</i>${closed ? '</v>' : ''}\r\n`;
	const result = await framescaperCaptionCustody(context, new File([text], 'interview.vtt'));
	assert.equal(result.losses.length, 1);
	assert.deepEqual(result.track.cues.map(cue => [cue.text, cue.startFrame, cue.endFrame]), [['Thinking about the interview.', 48_000, 144_000]]);
	assert.equal(result.track.speakers[0]?.name, 'John'); assert.equal(result.track.styles[0]?.fontStyle, 'italic');
	const saved = await result.sidecar('webvtt');
	assert.equal(saved.file.name, 'captions.vtt');
	assert.ok(saved.text.includes('<v John><i>Thinking about the interview.</i>'));
	assert.equal(saved.restored.cues[0]?.text, 'Thinking about the interview.');
	assert.equal(saved.restored.speakers[0]?.name, 'John'); assert.equal(saved.restored.styles[0]?.fontStyle, 'italic');
});

test('WebVTT header, notes and timing whitespace retain exact named cue through controller and Scape', async context => {
	const text = 'WEBVTT Interview transcript\n\nNOTE Reviewed on Friday\n\nhello\n00:00.100\t-->  00:00.500\nHello there.\n\nNOTE End of introduction\n';
	const result = await framescaperCaptionCustody(context, new File([text], 'interview.vtt'));
	assert.deepEqual(result.losses, []);
	assert.deepEqual(result.track.cues.map(cue => [cue.id, cue.text, cue.startFrame, cue.endFrame]), [['hello', 'Hello there.', 4800, 24_000]]);
	const saved = await result.sidecar('webvtt');
	assert.deepEqual(saved.restored.cues.map(cue => [cue.id, cue.text, cue.startFrame, cue.endFrame]), [['hello', 'Hello there.', 4800, 24_000]]);
});

for (const [name, text, encoding, title, start, end] of [
	['western.srt', SRT, 'latin1', 'Élodie au café', 4800, 24_000],
	['Styled.srt', '1\n00:00:01,000 --> 00:00:02,000\n<B><i>Hello & welcome</i></B>\n', 'utf8', 'Hello & welcome', 48_000, 96_000],
] as const) test(`Soundscaper ${name} retains independent literal label text and clocks through undo/redo and Scape`, async context => {
	const labels = await importedLabels(context, new File([Uint8Array.from(Buffer.from(text, encoding))], name, { type: 'application/x-subrip' }));
	assert.deepEqual(labels.map(label => [label.title, label.startFrame, label.endFrame]), [[title, start, end]]);
});

async function importedLabels(context: TestContext, file: File) {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection(), archive = createSoundscaperScapeNativeRuntime();
	const store = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
	const recipient = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: COPY, store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: archive,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		engineFactory: () => assert.fail('Caption custody must never substitute an audio renderer') });
	context.after(async () => { await controller.dispose(); await recipient.close(); });
	await controller.ready;
	await controller.actions.labels.importFile(file);
	const project: unknown = controller.project; assert.ok(validateSoundscaperProject(project));
	const track = project.tracks.find(track => track.type === 'label'); assert.ok(track?.type === 'label');
	controller.actions.edit.undo();
	const undone: unknown = controller.project; assert.ok(validateSoundscaperProject(undone));
	assert.ok(!undone.tracks.some(candidate => candidate.id === track.id));
	controller.actions.edit.redo();
	await controller.actions.project.flush();
	const current: unknown = controller.project; assert.ok(validateSoundscaperProject(current));
	const exported = await archive.exportScapeProject(current, store); assert.ok(exported.blob);
	const reopened = await archive.importScapeProject(exported.blob, recipient); assert.equal(reopened.readOnly, false);
	const restoredProject: unknown = reopened.project; assert.ok(validateSoundscaperProject(restoredProject));
	const restored = restoredProject.tracks.find(candidate => candidate.id === track.id); assert.ok(restored?.type === 'label');
	assert.deepEqual(restored.labels, track.labels);
	assert.equal(restoredProject.sources.length, 0);
	return restored.labels ?? [];
}
