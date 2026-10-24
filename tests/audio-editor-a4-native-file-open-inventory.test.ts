/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { isWorkspaceImportFile, partitionWorkspaceFiles, WORKSPACE_IMPORT_FILE_ACCEPT, WORKSPACE_OPEN_FILE_ACCEPT } from '../src/common/editor/ui/workspace/workspace-file-routing.js';

// These formats already have actual native File Import and saved-PCM controls.
const QUALIFIED_EXTENSIONS = ['ac3', 'amr', 'dts', 'eac3', 'iff', 'mov', 'mp1', 'paf', 'sbc', 'sds', 'sf', 'sph', 'spx', 'tta', 'voc', 'w64'];
for (const extension of QUALIFIED_EXTENSIONS) test(`File Open retains existing ${extension} media ownership without a platform MIME`, () => {
	for (const type of ['', 'application/octet-stream', 'text/plain']) {
		const file = { name: `Recording.${extension.toUpperCase()}`, type };
		assert.equal(isWorkspaceImportFile(file), true);
		assert.deepEqual(partitionWorkspaceFiles([file]), { projects: [], media: [file], labels: [], cues: [] });
	}
	assert.ok(WORKSPACE_IMPORT_FILE_ACCEPT.split(',').includes(`.${extension}`));
	assert.ok(WORKSPACE_OPEN_FILE_ACCEPT.split(',').includes(`.${extension}`));
});

test('native import inventory preserves unknown files and explicit project/label/CUE ownership', () => {
	assert.equal(isWorkspaceImportFile({ name: 'unknown.bin', type: 'application/octet-stream' }), false);
	const project = { name: 'Session.sscape' }, labels = { name: 'Labels.txt' }, cue = { name: 'Album.cue' };
	assert.deepEqual(partitionWorkspaceFiles([project, labels, cue]), { projects: [project], media: [], labels: [labels], cues: [cue] });
});
