/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { openWorkspaceProjectFile } from '../src/common/editor/ui/workspace/open-workspace-project-file.ts';
import { partitionWorkspaceFiles, WORKSPACE_OPEN_FILE_ACCEPT, WORKSPACE_IMPORT_FILE_ACCEPT } from '../src/common/editor/ui/workspace/workspace-file-routing.js';
import { importWorkspaceRoutedFiles } from '../src/common/editor/ui/workspace/import-workspace-routed-files.ts';

for (const extension of ['edl', 'otio', 'fcpxml', 'omf', 'omfi']) {
	test(`${extension} uses shared Open and Import project routing`, async () => {
		const file = new File(['fixture'], `session.${extension.toUpperCase()}`, { type: 'text/plain' });
		assert.ok(WORKSPACE_OPEN_FILE_ACCEPT.includes(`.${extension}`));
		assert.ok(WORKSPACE_IMPORT_FILE_ACCEPT.includes(`.${extension}`));
		assert.deepEqual(partitionWorkspaceFiles([file]).projects, [file]);
		const calls: File[] = [];
		const unexpected = () => assert.fail('interchange must reach its project importer');
		await openWorkspaceProjectFile({ ready: Promise.resolve(), actions: { project: {
			openAudacityProject: unexpected, openDawproject: unexpected,
			openInterchange: (input: File) => { calls.push(input); },
		} } }, file, unexpected);
		assert.deepEqual(calls, [file]);
	});
}

test('shared Import supplies selected media to the timeline importer without adding duplicate clips', async () => {
	const document = new File(['fixture'], 'session.otio');
	const audio = new File(['audio'], 'voice.wav');
	let opened = false;
	const unexpected = () => assert.fail('companions must only bind to interchange references');
	const count = await importWorkspaceRoutedFiles({
		controller: { project: { id: 'old' }, actions: { project: {
			importFiles: unexpected,
			openInterchange: (input: File, options: { mediaFiles?: readonly File[] }) => {
				assert.equal(input, document); assert.deepEqual(options.mediaFiles, [audio]); opened = true;
			},
		}, labels: { importFile: unexpected } } },
		files: [document, audio], importOptions: {}, openProjectFile: unexpected,
		projectBinVisible: false, requestCueImport: unexpected,
	});
	assert.equal(count, 2); assert.equal(opened, true);
});
