/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkGroupForModulePath, EDITOR_OPTIONAL_ARCHIVE_CHUNK_TEST } from '../scripts/lib/build-chunk-groups.mjs';

test('native DAW readers and controls stay behind optional project import entries', () => {
	for (const name of ['ardour-import', 'soundcraft-import', 'soundcraft-bundle', 'native-daw-import-values', 'timeline-interchange-audio-controls',
		'protools-binary', 'protools-audio', 'protools-tracks', 'protools-import', 'hindenburg-import', 'hindenburg-import-values']) {
		const path = `src/common/editor/${name}.ts`;
		assert.ok(EDITOR_OPTIONAL_ARCHIVE_CHUNK_TEST.test(path), path);
		assert.equal(chunkGroupForModulePath(path), null, path);
	}
});

test('DAWproject curve and clock adapters stay in their lazy archive closure', () => {
	for (const name of ['arrangement-media', 'export-automation', 'import-points', 'import-volume-curve']) {
		const path = `src/common/editor/dawproject-${name}.ts`;
		assert.ok(EDITOR_OPTIONAL_ARCHIVE_CHUNK_TEST.test(path), path);
		assert.equal(chunkGroupForModulePath(path), null, path);
	}
});

test('AAF parsing, writing and embedded export stay behind optional interchange entries', () => {
	for (const name of ['compound-reader', 'compound-writer', 'export', 'import', 'object-table', 'object-writer', 'wave']) {
		const path = `src/common/editor/aaf-${name}.ts`;
		assert.ok(EDITOR_OPTIONAL_ARCHIVE_CHUNK_TEST.test(path), path);
		assert.equal(chunkGroupForModulePath(path), null, path);
	}
	assert.equal(chunkGroupForModulePath('src/common/editor/controller/export/internal/embedded-audio-interchange-export-action.ts'), 'editor-optional-export');
});

test('AES31 codecs, packages and media staging stay behind optional interchange entries', () => {
	for (const name of ['edml', 'time', 'import', 'export', 'package']) {
		const path = `src/common/editor/aes31-${name}.ts`;
		assert.ok(EDITOR_OPTIONAL_ARCHIVE_CHUNK_TEST.test(path), path);
		assert.equal(chunkGroupForModulePath(path), null, path);
	}
	assert.equal(chunkGroupForModulePath('src/common/editor/controller/export/internal/aes31-export-action.ts'), 'editor-optional-export');
});
