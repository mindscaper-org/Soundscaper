/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { EDITOR_OPTIONAL_ARCHIVE_CHUNK_TEST, chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

test('project MIDI readers remain in the deferred archive closure', () => {
	for (const name of ['ardour-import-midi', 'soundcraft-import-midi', 'interchange-midi-clock', 'timeline-interchange-midi',
		'timeline-interchange-midi-files', 'aaf-import-midi', 'midi-file-import-channel-routing', 'midi-file-import-destinations', 'midi-file-import-tracks']) {
		const path = `src/common/editor/${name}.ts`;
		assert.equal(EDITOR_OPTIONAL_ARCHIVE_CHUNK_TEST.test(path), true, name);
		assert.equal(chunkGroupForModulePath(path), null, name);
	}
});
