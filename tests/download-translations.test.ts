/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createAnswersClient } from '../scripts/i18n-ai/answers.mjs';
import { assessTranslationCatalog, readTranslationCatalog, listTranslationCatalogLocales } from '../scripts/i18n-ai/catalog.mjs';
import { runCli } from '../scripts/i18n-ai/cli.mjs';
import { currentTranslations } from '../src/common/i18n/translation-catalog-validation.ts';
import { DOWNLOAD_ENGLISH_COPY, formatDownloadCopy } from '../src/common/site/download-copy.ts';
import { DOWNLOAD_LOCALES } from '../src/common/site/download-localization.ts';

const directory = fileURLToPath(new URL('../src/common/site/download-translations/', import.meta.url));

test('every non-English download route has a complete valid scoped catalog', async () => {
	const expected = DOWNLOAD_LOCALES.map(({ locale }) => locale).filter(locale => !locale.startsWith('en')).sort();
	assert.deepEqual(await listTranslationCatalogLocales(directory), expected);
	for (const locale of expected) {
		const catalog = await readTranslationCatalog(locale, directory);
		const assessment = assessTranslationCatalog(catalog, DOWNLOAD_ENGLISH_COPY);
		assert.deepEqual(assessment.missing, [], locale);
		assert.deepEqual(assessment.stale, [], locale);
		assert.deepEqual(assessment.orphaned, [], locale);
		assert.equal(Object.keys(currentTranslations(catalog, DOWNLOAD_ENGLISH_COPY, { locale })).length, Object.keys(DOWNLOAD_ENGLISH_COPY).length, locale);
	}
});

test('download translations retire changed English and preserve literal placeholder values', async () => {
	const catalog = await readTranslationCatalog('de', directory);
	const copy = currentTranslations(catalog, { ...DOWNLOAD_ENGLISH_COPY, title: 'Install {name}' }, { locale: 'de' });
	assert.equal(copy.title, undefined);
	assert.equal(copy.other, 'Andere Downloads');
	assert.equal(formatDownloadCopy('{name} {name}', { name: '$& <script>' }), '$& <script> $& <script>');
});

test('translation CLI packets and replay use the supplied source inventory and catalog directory', async () => {
	const root = await mkdtemp(join(tmpdir(), 'download-translations-'));
	try {
		const englishCopy = { downloadOnly: 'Download {name}' };
		const scopedDirectory = join(root, 'catalogs');
		const io = { directory: scopedDirectory, englishCopy, stdout: { write() {} }, stderr: { write() {} } };
		await runCli(['packets', '--locale', 'fr', '--no-glossary', '--output', join(root, 'packets')], io);
		const packet = JSON.parse(await readFile(join(root, 'packets/fr/001.json'), 'utf8')) as { messages: Record<string, string> };
		assert.deepEqual(packet.messages, englishCopy);
		const client = createAnswersClient({ locale: 'fr', answers: new Map([['downloadOnly', 'Télécharger {name}']]), model: 'test-translator' });
		await runCli(['translate', '--locale', 'fr', '--no-glossary'], { ...io, client, indexOptions: { jsonImportAttributes: true } });
		const catalog = await readTranslationCatalog('fr', scopedDirectory);
		assert.deepEqual(catalog.entries, { downloadOnly: ['machine', 'Download {name}', 'Télécharger {name}'] });
		assert.match(await readFile(join(scopedDirectory, 'index.js'), 'utf8'), /import\('\.\/fr\.json', \{ with: \{ type: 'json' \} \}\)/u);
		const loaded = execFileSync(process.execPath, ['--input-type=module', '-e', `
const { TRANSLATION_CATALOG_LOADERS } = await import(${JSON.stringify(pathToFileURL(join(scopedDirectory, 'index.js')).href)});
const { default: catalog } = await TRANSLATION_CATALOG_LOADERS.fr();
process.stdout.write(JSON.stringify(catalog.entries));
`], { encoding: 'utf8' });
		assert.deepEqual(JSON.parse(loaded), catalog.entries);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
