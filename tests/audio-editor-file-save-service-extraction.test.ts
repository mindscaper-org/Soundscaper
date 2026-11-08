/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';

test('timeline project saves retain the selected browser handle for later file publication', async () => {
	const handle = { name: 'Project.sscape', createWritable: async () => ({ write() {}, close() {} }) };
	const files = createAudioEditorFileService({ bridge: null, scope: { showSaveFilePicker: async () => handle } });
	const prepared = await files.prepareSave({ purpose: 'project', useFileSystemAccess: true });
	assert.equal(prepared.mode, 'stream');
	if (prepared.mode !== 'stream') throw new Error('Expected a direct save.');
	const stream = await prepared.createWritable(1), writer = stream.getWriter();
	await writer.write(new Uint8Array([7])); await writer.close(); writer.releaseLock();
	assert.deepEqual(await prepared.commit(), { method: 'file-system-access', fileName: 'Project.sscape', size: 1, fileHandle: handle });
});

test('desktop createDownload keeps the sanitized suggested name when the picker is dismissed', async () => {
	const names: unknown[] = [];
	const files = createAudioEditorFileService({ bridge: { chooseSaveTarget(request: { suggestedName: string }) {
		names.push(request.suggestedName); throw new DOMException('Dismissed', 'AbortError');
	} } });
	assert.deepEqual(await files.createDownload({ purpose: 'project', fileName: '  Bad:/name.liscape. ', text: 'abc' }),
		{ cancelled: true, fileName: 'Bad-name.liscape', size: 3 });
	assert.deepEqual(await files.createDownload({ purpose: 'report', text: 'xyz' }),
		{ cancelled: true, fileName: 'soundscaper-export', size: 3 });
	assert.deepEqual(names, ['Bad-name.liscape', 'soundscaper-export']);
});
