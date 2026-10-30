/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { EDITOR_ENGLISH_COPY } from '../src/common/i18n/editor-copy-inventory.ts';
import { resolveCatalog } from '../src/common/i18n/runtime.js';
import { resolveCorridorKeyCopy } from '../src/common/i18n/editor-corridorkey-copy.ts';

test('CorridorKey uses the editor translation catalog and retains English fallbacks', async () => {
	assert.equal(EDITOR_ENGLISH_COPY['ui.corridorKey.hintEnabled'], 'Run Chroma Key first');
	const french = await resolveCatalog('fr', { translationLoaders: {
		fr: async () => ({ schemaVersion: 2, locale: 'fr', entries: {
			'ui.corridorKey.hintEnabled': ['human', 'Run Chroma Key first', 'Exécuter Chroma Key en premier'],
		} }),
	} });
	const copy = resolveCorridorKeyCopy(french);
	assert.equal(copy.hintEnabled, 'Exécuter Chroma Key en premier');
	assert.equal(copy.hintTitle, 'Alpha hint');
});
