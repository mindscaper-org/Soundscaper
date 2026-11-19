/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCatalog } from '../src/common/i18n/runtime.js';
import { loadTranslationCatalog } from '../src/common/i18n/translation-catalog.js';
import { FREESOUND_ATTRIBUTION_ENGLISH_COPY } from '../src/common/i18n/freesound-attribution-copy.js';

test('the Spanish and French delivery queue calls its archive option audio tracks', async () => {
	const [spanish, french] = await Promise.all([resolveCatalog('es'), resolveCatalog('fr')]);
	assert.equal(spanish.stems, 'Pistas individuales (archivo)');
	assert.equal(french.stems, 'Pistes individuelles (archive)');
});

test('the German Freesound publisher identifies solo percussion as percussion', async () => {
	const key = 'ui.freesoundAttribution.taxonomyMusicSoloPercussion';
	const german = await loadTranslationCatalog('de', { englishCopy: { [key]: FREESOUND_ATTRIBUTION_ENGLISH_COPY.taxonomyMusicSoloPercussion } });
	assert.equal(german?.[key], 'Musik — Solo-Perkussion');
});
