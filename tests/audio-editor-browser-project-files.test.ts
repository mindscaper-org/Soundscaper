/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseBrowserProjectFiles } from '../src/common/editor/browser-project-files.ts';
import { browserProjectHandle } from '../src/common/editor/file-save-stream.ts';

test('browser project opens retain only granted write permission and cancellation preserves the workspace', async () => {
	const file = new File(['data'], 'project.sscape');
	const handle = { getFile: async () => file, createWritable() {}, requestPermission: async () => 'granted' };
	assert.deepEqual(await chooseBrowserProjectFiles({ showOpenFilePicker: async () => [handle] }), [file]);
	assert.equal(browserProjectHandle(file), handle);
	const deniedFile = new File(['data'], 'denied.sscape');
	await chooseBrowserProjectFiles({ showOpenFilePicker: async () => [{ ...handle, getFile: async () => deniedFile, requestPermission: async () => 'denied' }] });
	assert.equal(browserProjectHandle(deniedFile), undefined);
	assert.deepEqual(await chooseBrowserProjectFiles({ showOpenFilePicker: async () => { throw new DOMException('cancelled', 'AbortError'); } }), []);
	await assert.rejects(chooseBrowserProjectFiles({ showOpenFilePicker: async () => { throw new Error('picker failed'); } }), /picker failed/u);
});

test('File Open can read a Scape project when the optional write grant throws', async () => {
	const file = new File(['data'], 'readable.sscape');
	const handle = { getFile: async () => file, createWritable() {}, requestPermission: async () => {
		throw new DOMException('The file cannot be granted write access.', 'NotAllowedError');
	} };
	assert.deepEqual(await chooseBrowserProjectFiles({ showOpenFilePicker: async () => [handle] }), [file]);
	assert.equal(browserProjectHandle(file), undefined);
});

test('opening a recording as a new project does not request write access to the recording', async () => {
	const file = new File(['recording'], 'incoming.wav');
	let grants = 0;
	const handle = { getFile: async () => file, createWritable() {}, requestPermission: async () => { grants++; return 'granted'; } };
	assert.deepEqual(await chooseBrowserProjectFiles({ showOpenFilePicker: async () => [handle] }), [file]);
	assert.equal(grants, 0);
	assert.equal(browserProjectHandle(file), undefined);
});
