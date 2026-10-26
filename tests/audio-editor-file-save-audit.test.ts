/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFileSystemPreparedSave } from '../src/common/editor/file-save-stream.ts';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { portableFileStem } from '../src/common/editor/portable-file-stem.ts';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>(accept => { resolve = accept; });
	return { promise, resolve };
}

test('disk-full failure while closing a streamed export aborts the destination', async () => {
	let aborted = 0;
	const save = createFileSystemPreparedSave({ fileName: 'mix.wav', target: {
		async createWritable() { return {
			write() {}, close() { throw new Error('disk full'); }, abort() { aborted++; },
		}; },
	} });
	const writer = (await save.createWritable(1)).getWriter();
	await writer.write(Uint8Array.of(1)); await writer.close();
	await assert.rejects(save.commit(), /disk full/u);
	assert.equal(aborted, 1);
	await assert.rejects(save.commit(), /disk full/u);
	assert.equal(aborted, 1);
});

test('overlapping export completion shares one filesystem close', async () => {
	const closing = deferred(); let closes = 0;
	const save = createFileSystemPreparedSave({ fileName: 'mix.wav', target: {
		async createWritable() { return {
			write() {}, async close() { closes++; await closing.promise; }, abort() {},
		}; },
	} });
	const writer = (await save.createWritable(0)).getWriter(); await writer.close();
	const first = save.commit(); const second = save.commit(); closing.resolve();
	assert.deepEqual(await first, await second);
	assert.equal(closes, 1);
});

test('cancelling before a streamed export opens keeps the destination closed', async () => {
	let opens = 0;
	const save = createFileSystemPreparedSave({ fileName: 'mix.wav', target: {
		async createWritable() { opens++; return { write() {}, close() {} }; },
	} });
	await save.abort(new Error('cancelled'));
	await assert.rejects(save.createWritable(2), /cancelled/u);
	assert.equal(opens, 0);
});

test('cancelling while a streamed export opens aborts its acquired writer', async () => {
	const opening = deferred(); let aborts = 0;
	const save = createFileSystemPreparedSave({ fileName: 'mix.wav', target: {
		async createWritable() { await opening.promise; return { write() {}, close() {}, abort() { aborts++; } }; },
	} });
	const writable = save.createWritable(2);
	await save.abort(new Error('cancelled'));
	opening.resolve();
	await assert.rejects(writable, /cancelled/u);
	assert.equal(aborts, 1);
});

test('download preparation honors cancellation before allocating an object URL', async () => {
	let allocations = 0;
	const service = createAudioEditorFileService({ bridge: null, urlApi: {
		createObjectURL() { allocations++; return 'blob:cancelled'; }, revokeObjectURL() {},
	} });
	await assert.rejects(service.createDownload({ text: 'audio', signal: AbortSignal.abort() }), { name: 'AbortError' });
	assert.equal(allocations, 0);
});

test('file exports keep their suffix within the UTF-8 filesystem filename limit', async () => {
	const service = createAudioEditorFileService({ bridge: null });
	const target = await service.chooseSaveTarget({ purpose: 'audio', suggestedName: `${'録'.repeat(100)}.wav` });
	assert.ok(new TextEncoder().encode(target.name).length <= 255);
	assert.match(target.name, /\.wav$/u);
	for (const boundary of [' ', '.']) {
		const shortened = await service.chooseSaveTarget({ purpose: 'audio', suggestedName: `${'a'.repeat(254)}${boundary}long-suffix-without-extension` });
		assert.doesNotMatch(shortened.name, /[. ]$/u);
	}
});

test('portable interchange filenames escape Windows device names', async () => {
	for (const name of ['CON', 'prn', 'aux', 'NUL', 'COM1', 'lpt9', 'COM¹']) {
		const service = createAudioEditorFileService({ bridge: null });
		const target = await service.chooseSaveTarget({ purpose: 'interchange', suggestedName: `${name}.txt` });
		assert.doesNotMatch(target.name, /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])\./iu);
	}
	assert.equal(portableFileStem('CON'), '_CON');
	assert.equal(portableFileStem('aux.master'), '_aux.master');
	assert.equal(portableFileStem(`CON.${'a'.repeat(100)}`).length, 64);
});

test('saved file status uses the name the user selected in the save picker', async () => {
	const service = createAudioEditorFileService({ bridge: null });
	const saved = await service.saveFile({ suggestedName: 'mix.wav', text: 'data', target: {
		name: 'my-master.wav', async createWritable() { return { async write() {}, async close() {} }; },
	} });
	assert.equal(saved.fileName, 'my-master.wav');
});
