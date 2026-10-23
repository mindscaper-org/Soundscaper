/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalizedError, formatPresentationMessage, type LocalizedPresentationMessage } from '../src/common/i18n/presentation-message.ts';
import { publishImportFailureStatus } from '../src/common/editor/controller/import/internal/import-status-localization.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

test('a failed native media import retains the file and its diagnostic after publishing the summary', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	let decoded = 0, codecDecoded = 0;
	const failure = new DOMException('The selected audio contains no decodable frames.', 'EncodingError');
	const engine = { ...createMemoryEngine(), async decodeAudioData() { decoded++; throw failure; } };
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		engine: engine as unknown as Options['engine'], ffmpeg: { ...createMemoryFfmpeg(), async decode() { codecDecoded++; throw failure; } } as unknown as Options['ffmpeg'],
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }) });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.project.importFiles([new File(['no decodable audio'], 'Broken recording.bin')]);
	const status = controller.getSnapshot().status;
	assert.equal(status.state, 'error');
	assert.equal(decoded, 1, 'the real import invokes its native decoder port');
	assert.equal(codecDecoded, 1, 'the existing codec fallback also refuses this recording');
	assert.match(status.message, /Broken recording\.bin/u);
	assert.match(status.message, /no decodable frames/u);
	assert.equal(controller.project?.sources.length, 0);
});

test('the final import diagnostic keeps localization identity and bounds repeated failures', () => {
	const copy = { importSummary: '{successes} imported, {failures} failed.', storageFull: 'Storage is full.', unknownError: 'Unknown error' };
	const failure = createLocalizedError(Error, copy, 'storageFull');
	let text = '', descriptor: LocalizedPresentationMessage | undefined;
	publishImportFailureStatus((value, state, localization) => { assert.equal(state, 'error'); text = value; descriptor = localization; },
		copy, 1, 5, Array.from({ length: 5 }, (_, index) => ({ fileName: `März-${index}.wav`, error: failure })));
	assert.equal(text, '1 imported, 5 failed.\nMärz-0.wav: Storage is full.\nMärz-1.wav: Storage is full.\nMärz-2.wav: Storage is full.');
	assert.ok(descriptor);
	assert.equal(formatPresentationMessage({ importSummary: '{successes} importiert, {failures} fehlgeschlagen.', storageFull: 'Speicher voll.' }, descriptor),
		'1 importiert, 5 fehlgeschlagen.\nMärz-0.wav: Speicher voll.\nMärz-1.wav: Speicher voll.\nMärz-2.wav: Speicher voll.');
});
