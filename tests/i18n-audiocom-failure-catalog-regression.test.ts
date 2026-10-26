/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { AUDIOCOM_COPY_BY_LOCALE } from '../src/common/i18n/audiocom-copy.ts';
import { currentTranslations } from '../src/common/i18n/translation-catalog.js';

const FAILURE_KEYS = ['connectionExpired', 'previewFailed', 'projectArchiveRefreshFailed', 'searchRequestHttpFailed'] as const;
const ENGLISH = Object.fromEntries(FAILURE_KEYS.map((key) => [`ui.audiocom.${key}`, AUDIOCOM_COPY_BY_LOCALE.en[key]]));
const CATALOG_DIRECTORY = new URL('../src/common/i18n/translations/', import.meta.url);

for (const locale of ['es', 'it', 'pt-BR', 'pt-PT']) {
	test(`${locale} publishes current translated audio.com failure sentences`, async () => {
		const catalog: unknown = JSON.parse(await readFile(new URL(`${locale}.json`, CATALOG_DIRECTORY), 'utf8'));
		const translations = currentTranslations(catalog, ENGLISH, { locale });
		for (const [key, source] of Object.entries(ENGLISH)) {
			assert.ok(Object.hasOwn(translations, key), `${locale} must publish a current translation for ${key}`);
			assert.notEqual(translations[key], source, `${locale} must translate the full sentence ${key}`);
		}
	});
}
