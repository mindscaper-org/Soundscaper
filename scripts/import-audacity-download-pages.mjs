/* SPDX-License-Identifier: AGPL-3.0-only */

// Import the user-maintained page content without importing its Astro site shell.
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { writeTranslationCatalogIndex } from './i18n-ai/catalog.mjs';

const source = resolve(process.argv[2] ?? '../kw.media');
const output = resolve(import.meta.dirname, '../src/common/site/audacity-download');
const catalogs = resolve(output, 'catalogs');
await mkdir(catalogs, { recursive: true });
const languages = [];
for (const filename of (await readdir(resolve(source, 'src/data/audacity-download-locales'))).sort()) {
	if (!filename.endsWith('.json')) continue;
	const content = await readFile(resolve(source, 'src/data/audacity-download-locales', filename), 'utf8');
	const { nativeName, direction } = JSON.parse(content);
	languages.push({ locale: filename.slice(0, -5), nativeName, direction });
	await writeFile(resolve(catalogs, filename), content);
}
await writeTranslationCatalogIndex(catalogs, { jsonImportAttributes: true });
await writeFile(resolve(output, 'languages.json'), JSON.stringify(languages, null, '\t') + '\n');
await copyFile(resolve(source, 'src/data/audacity-downloads.json'), resolve(output, 'releases.json'));
const omitted = new Set(['Export each label as its own file', 'Export tracks as separate stems', 'Trim audio outside the selection',
	'Jedes Label als separate Datei exportieren', 'Spuren als separate Stems exportieren', 'Audio außerhalb der Auswahl kürzen']);
for (const [locale, filename] of [
	['en', 'audacity-4-is-missing-lots-of-audacity-3-features-i-added-them.md'],
	['de', 'audacity-4-fehlt-vieles-von-audacity-3-ich-habe-es-hinzugefugt.md'],
]) {
	const post = await readFile(resolve(source, 'src/data/posts/audacity', filename), 'utf8');
	const rows = post.split('\n').filter(line => line.startsWith('|')).map(line => line.split('|').slice(1, -1).map(cell => cell.trim()))
		.filter(cells => cells.length === 4 && !/^[- :]+$/u.test(cells[0]) && !omitted.has(cells[0]))
		.map(([feature, audacity3, audacity4, soundscaper]) => [feature, soundscaper, audacity4, audacity3]);
	await writeFile(resolve(output, `comparison-${locale}.json`), JSON.stringify(rows, null, '\t') + '\n');
}
await writeFile(resolve(output, 'provenance.json'), JSON.stringify({
	repository: 'kw.media', revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim(),
	content: 'Download catalogs, fallback releases, and the two reviewed Audacity comparison tables. Catalog text is preserved verbatim.',
}, null, '\t') + '\n');
