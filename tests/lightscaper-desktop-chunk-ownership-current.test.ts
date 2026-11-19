/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

test('Lightscaper desktop close lifecycle stays with scalar photo ownership', () => {
	for (const separator of ['/', '\\']) {
		const path = 'src/common/editor/controller/composition/lightscaper-desktop-lifecycle.ts'.replaceAll('/', separator);
		assert.equal(chunkGroupForModulePath(path), 'editor-photo-library-scalars');
		assert.notEqual(chunkGroupForModulePath(path + '.foreign'), 'editor-photo-library-scalars');
	}
	assert.equal(chunkGroupForModulePath('src/common/i18n/lightscaper-desktop-close-copy.ts'), 'lightscaper-editor-copy');
});

test('Lightscaper native archive admission remains in scalar photo ownership without timeline initialization', () => {
	for (const path of ['src/common/editor/controller/composition/lightscaper-desktop-archive-open-current-v1.ts',
		'src/common/editor/desktop-lightscaper-archive-open-contract-current-v1.ts']) for (const separator of ['/', '\\']) {
		const normalized = path.replaceAll('/', separator);
		assert.equal(chunkGroupForModulePath(normalized), 'editor-photo-library-scalars');
		assert.notEqual(chunkGroupForModulePath(normalized + '.foreign'), 'editor-photo-library-scalars');
	}
	assert.equal(chunkGroupForModulePath('src/common/editor/desktop-read-profile.ts'), 'editor-neutral-foundations');
});
