/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

const maximumCharacters = 16 * 1024 * 1024;
const maximumEncodedBytes = maximumCharacters * 3 + 3;

async function fixture(context: test.TestContext) {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	return controller;
}

for (const format of ['srt', 'cue'] as const) {
	test(`oversized ${format} sidecars are refused before a whole-file native read`, async context => {
		const controller = await fixture(context);
		const before = controller.project;
		let reads = 0;
		class ObservedFile extends File {
			override async arrayBuffer(): Promise<ArrayBuffer> { reads += 1; return super.arrayBuffer(); }
		}
		const oversized = new ObservedFile([new Uint8Array(maximumEncodedBytes + 1)], `Too large.${format}`);
		const importing = format === 'cue'
			? controller.actions.labels.importCueFile(oversized, 'labels')
			: controller.actions.labels.importFile(oversized);
		await assert.rejects(importing, /input limit/u);
		assert.equal(reads, 0, 'File.size already proves the existing decoded character limit cannot be satisfied');
		assert.equal(controller.project, before);
		const result = await controller.actions.labels.importFile(new File(['0\t1\tHealthy retry'], 'Retry.txt'));
		assert.equal(result?.labels[0]?.title, 'Healthy retry');
	});
}

test('the read preflight admits maximum-length UTF-8 with three bytes per character and a BOM', async context => {
	const controller = await fixture(context);
	const suffix = '\nTRACK 01 AUDIO\n TITLE Healthy\n INDEX 01 00:00:00\n';
	const cue = `REM ${'漢'.repeat(maximumCharacters - 4 - suffix.length)}${suffix}`;
	assert.equal(cue.length, maximumCharacters);
	const file = new File(['\uFEFF', cue], 'Unicode.cue');
	assert.ok(file.size > maximumCharacters * 2);
	assert.ok(file.size <= maximumEncodedBytes);
	assert.equal((await controller.actions.labels.importCueFile(file, 'labels'))?.count, 1);
});

test('UTF-16 SubRip and Windows-1252 CUE stay admitted by the read preflight', async context => {
	const controller = await fixture(context);
	const srt = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('1\r\n00:00:00,000 --> 00:00:01,000\r\n漢字\r\n', 'utf16le')]);
	assert.equal((await controller.actions.labels.importFile(new File([srt], 'Unicode.srt')))?.labels[0]?.title, '漢字');
	const cue = Buffer.from('TRACK 01 AUDIO\n TITLE "Caf\xe9"\n INDEX 01 00:00:00\n', 'latin1');
	assert.equal((await controller.actions.labels.importCueFile(new File([cue], 'Legacy.cue'), 'labels'))?.count, 1);
});
