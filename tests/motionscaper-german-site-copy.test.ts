/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { SITE_COPY_BY_LOCALE } from '../src/common/i18n/site-copy.js';
import { loadTranslationCatalog } from '../src/common/i18n/translation-catalog.js';

test('the real German catalog retains the authored Motionscaper site labels', async () => {
	const translated = await loadTranslationCatalog('de', {
		englishCopy: SITE_COPY_BY_LOCALE.en,
		loaders: { de: () => import('../src/common/i18n/translations/de.json', { with: { type: 'json' } }) },
	});
	assert.ok(translated);
	assert.deepEqual({
		motionscaperTitle: translated.motionscaperTitle,
		motionscaperMetaDescription: translated.motionscaperMetaDescription,
		workspaceMotion: translated.workspaceMotion,
		otherEditors: translated.otherEditors,
	}, {
		motionscaperTitle: 'Motionscaper',
		motionscaperMetaDescription: 'Motion-Design und Compositing.',
		workspaceMotion: 'Motion-Arbeitsbereich',
		otherEditors: 'Weitere Editoren',
	});
});
