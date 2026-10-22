/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { detectAudioEditorLabelFormat, parseAudioEditorLabels } from '../src/common/editor/label-io.js';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const encoding of ['windows-1252', 'utf-16le'] as const) test(`extensionless SubRip media type admits its existing ${encoding} decoding`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `next-label-type-${encoding}` }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	const text = '1\r\n00:00:00,100 --> 00:00:00,500\r\nÉlodie au café\r\n';
	const bytes = encoding === 'windows-1252' ? Buffer.from(text, 'latin1') : Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
	await controller.actions.labels.importFile(new File([bytes], 'Captions', { type: 'application/x-subrip' }));
	const exported = await controller.actions.labels.export({ download: false });
	assert.match(exported.text, /Élodie au café/u);
	controller.actions.edit.undo();
	assert.equal(controller.project?.tracks.some(track => track.type === 'label'), false);
	controller.actions.edit.redo();
	assert.match((await controller.actions.labels.export({ download: false })).text, /Élodie au café/u);
});


test('label MIME hints retain explicit format and known filename precedence and strict WebVTT/TXT decoding', () => {
	assert.equal(detectAudioEditorLabelFormat({ filename: 'Captions.TXT', mimeType: 'application/x-subrip' }), 'txt');
	assert.equal(detectAudioEditorLabelFormat({ filename: 'Captions', format: 'txt', mimeType: 'text/vtt' }), 'txt');
	assert.equal(detectAudioEditorLabelFormat({ filename: 'Captions', mimeType: 'Application/X-SubRip; charset=windows-1252' }), 'srt');
	const text = new TextEncoder().encode('0\t0.5\tPlain title');
	assert.equal(parseAudioEditorLabels(text, { filename: 'Captions.txt', mimeType: 'text/vtt' }).labels[0]?.title, 'Plain title');
	for (const mimeType of ['text/vtt', 'text/plain', 'application/octet-stream']) {
		assert.throws(() => parseAudioEditorLabels(new Uint8Array([0xe9]), { filename: 'Captions', mimeType }), { code: 'INVALID_UTF8' });
	}
});
