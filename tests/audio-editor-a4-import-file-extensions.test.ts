/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { IMPORT_FILE_EXTENSIONS, IMPORT_FILE_EXTENSION_LIST, isImportFileName } from '../src/common/editor/import-file-extensions.ts';
import { maintainedAiffMimeType } from '../src/common/editor/controller/import/internal/aiff-file-identity.ts';
import { isScapeProjectFile, SCAPE_MIME_TYPE } from '../src/common/editor/scape-project-format.ts';
import { WORKSPACE_IMPORT_FILE_ACCEPT, partitionWorkspaceFiles } from '../src/common/editor/ui/workspace/workspace-file-routing.js';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

test('the complete import registry supplies chooser, MIME conflict and filename precedence together', () => {
	assert.equal(new Set(IMPORT_FILE_EXTENSIONS).size, IMPORT_FILE_EXTENSIONS.length);
	assert.equal(IMPORT_FILE_EXTENSION_LIST, IMPORT_FILE_EXTENSIONS.join(','));
	assert.deepEqual(WORKSPACE_IMPORT_FILE_ACCEPT.split(',').filter(token => token.startsWith('.')), IMPORT_FILE_EXTENSIONS);
	for (const suffix of IMPORT_FILE_EXTENSIONS) {
		const name = `Recording${suffix.toUpperCase()}`;
		assert.equal(isImportFileName(name), true);
		assert.equal(isScapeProjectFile({ name, type: SCAPE_MIME_TYPE }), false);
		assert.equal(maintainedAiffMimeType({ name, type: 'audio/aiff' }), /^\.aif[fc]?$/u.test(suffix) ? 'audio/aiff' : null);
		const file = { name, type: 'text/plain' };
		if (!['.txt', '.srt', '.vtt', '.cue'].includes(suffix)) assert.deepEqual(partitionWorkspaceFiles([file]), { projects: [], media: [file], labels: [], cues: [] });
	}
	assert.equal(chunkGroupForModulePath('src/common/editor/import-file-extensions.ts'), 'project-interchange-foundations');
});

test('import suffix authority belongs to the final path segment and retains unknown-name MIME fallback', () => {
	for (const value of [null, undefined, {}, '', 'Recording', 'Recording.bin', 'audio.sds/final', 'audio.sds\\final']) assert.equal(isImportFileName(value), false);
	assert.equal(isImportFileName('audio/path/Recording.SDS'), true);
	assert.equal(isImportFileName('audio\\path\\Recording.MP1'), true);
	assert.equal(maintainedAiffMimeType({ name: 'Recording.backup', type: 'audio/aiff' }), 'audio/aiff');
	assert.equal(isScapeProjectFile({ name: 'Session.backup', type: SCAPE_MIME_TYPE }), true);
});
