/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createInterchangeFileImport } from '../src/common/editor/controller/composition/internal/interchange-file-import.ts';

test('timeline and project-bin imports open AAF with selected companion media', async () => {
	const document = new File(['aaf'], 'edit.AAF'), wave = new File(['wav'], 'Voice.wav');
	let opened = false;
	const importFiles = createInterchangeFileImport(() => assert.fail('AAF must open as a project'), async (file, options) => {
		assert.equal(file, document); assert.deepEqual(options?.mediaFiles, [wave]); opened = true; return undefined;
	});
	await importFiles([wave, document], { destination: 'timeline', timelineStartFrame: 99 });
	assert.equal(opened, true);
});

test('ordinary source drops retain their destination and cancellation options', async () => {
	const wave = new File(['wav'], 'Voice.wav'), options = { destination: 'project-bin', signal: new AbortController().signal };
	const importFiles = createInterchangeFileImport((files, input) => {
		assert.deepEqual(files, [wave]); assert.equal(input, options); return Promise.resolve(42);
	}, () => assert.fail('ordinary media must use its importer'));
	assert.equal(await importFiles([wave], options), 42);
});
