/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { EDITOR_ENGLISH_COPY } from '../src/common/i18n/editor-copy-inventory.ts';
import { DEFAULT_LOCALE_TAGS } from '../src/common/i18n/locales.js';
import { bundledSiteCopyForLocale, SITE_COPY_BY_LOCALE } from '../src/common/i18n/site-copy.js';
import { bundledCatalogForLocale, resolveCatalog } from '../src/common/i18n/runtime.js';
import { assertMachineTranslatableLocale, readTranslationCatalog } from '../scripts/i18n-ai/catalog.mjs';
import { machineTranslatableLocales } from '../scripts/i18n-ai/cli.mjs';

test('German uses only its JSON catalog and the common English fallback', async () => {
	assert.ok(bundledCatalogForLocale('de') === EDITOR_ENGLISH_COPY);
	assert.equal(bundledSiteCopyForLocale('de'), SITE_COPY_BY_LOCALE.en);
	assert.deepEqual(DEFAULT_LOCALE_TAGS, ['en']);
	const german = await resolveCatalog('de');
	assert.equal(german.fileMenu, 'Datei');
	assert.equal(german['ui.macroManager.runProgram'], 'Programm ausführen');
	const catalog = await readTranslationCatalog('de');
	assert.deepEqual(catalog.entries.fileMenu, ['machine', 'File', 'Datei']);
	assert.equal(catalog.entries.play[0], 'audacity');
	const missing = await resolveCatalog('de', { translationLoaders: {} });
	assert.deepEqual(missing, EDITOR_ENGLISH_COPY);
	const stale = await resolveCatalog('de', { translationLoaders: {
		de: async () => ({ schemaVersion: 2, locale: 'de', entries: {
			fileMenu: ['human', 'Former English', 'Veraltete Übersetzung'],
		} }),
	} });
	assert.equal(stale.fileMenu, EDITOR_ENGLISH_COPY.fileMenu);
});

test('German participates in automatic translation like other non-English languages', () => {
	assert.equal(assertMachineTranslatableLocale('de'), 'de');
	assert.deepEqual(machineTranslatableLocales(['en', 'de', 'fr']), ['de', 'fr']);
});
