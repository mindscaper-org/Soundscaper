/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { unified } from '@astrojs/markdown-remark';

import {
	COMPARISON_SOURCE, GENERATED_COMPARISON_DIRECTORY, generateComparisonDocuments, renderComparisonDocuments,
} from '../scripts/lib/handbook-comparisons.ts';
import rehypeVerdictTables from '../handbook/src/plugins/rehype-verdict-tables.mjs';
import rehypeComparisonDetails from '../handbook/src/plugins/rehype-comparison-details.mjs';
import rehypeComparisonLayout from '../handbook/src/plugins/rehype-comparison-layout.mjs';
import rehypeComparisonSummary from '../handbook/src/plugins/rehype-comparison-summary.mjs';

const fixture = `---
title: How Soundscaper compares
description: Main comparison.
---

Main introduction.

## Platforms

These qualifications apply to the table.

| Capability | Soundscaper<br>Web | Soundscaper<br>Desktop | Other Editor<br>2.0 |
| --- | --- | --- | --- |
| Runs on Linux | + | + | / |
| Native plug-ins | / | + — VST3 :: Optional engine with a [guide](/help/local-processing/). | ~ — Limited |

## Formats

| Format | Soundscaper<br>Web | Soundscaper<br>Desktop | Other Editor<br>2.0 |
| --- | --- | --- | --- |
| A \\| B | ~ — Import | + — ${'`archive`'} | / |

## Verdict totals {#verdict-totals}

<!-- comparison-summary -->
`;

test('each counterpart gets every section and row with Desktop first and original cell notes intact', () => {
	const pages = renderComparisonDocuments(fixture);
	assert.deepEqual([...pages.keys()], ['index.md', 'soundscaper-vs-soundscaper-web.md', 'soundscaper-vs-other-editor.md']);
	const other = pages.get('soundscaper-vs-other-editor.md')!;
	assert.match(other, /title: "Soundscaper vs Other Editor 2\.0"/u);
	assert.match(other, /\| Capability \| Soundscaper<br>Desktop \| Other Editor<br>2\.0 \|/u);
	assert.match(other, /\| Runs on Linux \| \+ \| \/ \|/u);
	assert.ok(other.includes('| Native plug-ins | + — VST3 :: Optional engine with a [guide](/help/local-processing/). | ~ — Limited |'));
	assert.ok(other.includes('| A \\| B | + — `archive` | / |'));
	assert.ok(other.includes('These qualifications apply to the table.'));
	assert.ok(other.includes('## Formats'));
	assert.ok(other.includes('<!-- comparison-summary -->'));
	assert.ok(!other.includes('Soundscaper<br>Web'));
	const web = pages.get('soundscaper-vs-soundscaper-web.md')!;
	assert.ok(web.includes('| Native plug-ins | + — VST3 :: Optional engine with a [guide](/help/local-processing/). | / |'));
	assert.ok(pages.get('index.md')!.includes('[Soundscaper vs Other Editor 2.0](/start/comparisons/soundscaper-vs-other-editor/)'));
});

test('source edits regenerate all affected pages and reviewed version changes keep stable URLs', () => {
	const changed = fixture.replaceAll('Other Editor<br>2.0', 'Other Editor<br>3.0')
		.replace('| Runs on Linux | + | + | / |', '| Runs on Linux | + | ~ — ARM only :: Details. | + |');
	const pages = renderComparisonDocuments(changed);
	assert.match(pages.get('soundscaper-vs-other-editor.md')!, /title: "Soundscaper vs Other Editor 3\.0"/u);
	for (const [name, content] of pages) {
		if (name !== 'index.md') assert.ok(content.includes('| Runs on Linux | ~ — ARM only :: Details. |'));
	}
});

test('ambiguous or malformed source tables fail instead of publishing the wrong comparison', () => {
	assert.throws(() => renderComparisonDocuments('No comparison tables.'), /comparison table/iu);
	assert.throws(() => renderComparisonDocuments(fixture.replaceAll('Soundscaper<br>Desktop', 'Something else')), /Soundscaper Desktop/u);
	assert.throws(() => renderComparisonDocuments(fixture.replace('| Runs on Linux | + | + | / |', '| Runs on Linux | + | / |')), /column/iu);
	assert.throws(() => renderComparisonDocuments(fixture.replace('Other Editor<br>2.0 |\n| ---', 'Different Editor |\n| ---')), /headers/iu);
	assert.throws(() => renderComparisonDocuments(fixture.replaceAll('Other Editor<br>2.0', 'Soundscaper<br>Web')), /duplicate/iu);
});

test('generated pairwise tables keep accessible verdicts, details, row headings, and exactly two summary charts', async () => {
	const source = renderComparisonDocuments(fixture).get('soundscaper-vs-other-editor.md')!;
	const renderer = await unified({ rehypePlugins: [
		rehypeVerdictTables, rehypeComparisonDetails,
		[rehypeComparisonLayout, { groups: [{ label: 'Main matrix', families: [['Unrelated product']] }] }],
		rehypeComparisonSummary,
	] }).createRenderer({ syntaxHighlight: false });
	const { code } = await renderer.render(source.replace(/^---\n[\s\S]*?\n---\n/u, ''), {
		fileURL: pathToFileURL(resolve(GENERATED_COMPARISON_DIRECTORY, 'soundscaper-vs-other-editor.md')),
	});
	const document = new JSDOM(code).window.document;
	assert.equal(document.querySelectorAll('table.verdict-table').length, 2);
	assert.equal(document.querySelectorAll('[scope="row"]').length, 3);
	assert.equal(document.querySelectorAll('.comparison-summary figure').length, 2);
	assert.deepEqual([...document.querySelector('table')!.querySelectorAll('thead tr:last-child th')].map(cell => {
		const copy = cell.cloneNode(true) as Element;
		copy.querySelector('.comparison-counter')?.remove();
		copy.querySelectorAll('br').forEach(br => br.replaceWith(' '));
		return copy.textContent;
	}), [
		'Soundscaper Desktop', 'Other Editor 2.0',
	]);
	const trigger = document.querySelector('.comparison-note-trigger')!;
	assert.equal(document.getElementById(trigger.getAttribute('aria-describedby')!)?.textContent, 'Optional engine with a guide.');
	assert.ok(document.querySelector('[aria-label="Supported"]'));
});

test('the committed derivative pages match the main table, including Web and all nine other editors', async () => {
	const source = await readFile(COMPARISON_SOURCE, 'utf8');
	const pages = renderComparisonDocuments(source);
	assert.equal(pages.size, 11);
	for (const [name, content] of pages) assert.equal(await readFile(join(GENERATED_COMPARISON_DIRECTORY, name), 'utf8'), content, name);
	assert.deepEqual((await generateComparisonDocuments(process.cwd(), { write: false })).stale, []);
});

test('check mode reports missing pages without writing, and regeneration is idempotent', async context => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-comparisons-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	await mkdir(join(root, 'handbook/src/content/docs/start'), { recursive: true });
	await writeFile(join(root, COMPARISON_SOURCE), fixture);
	assert.equal((await generateComparisonDocuments(root, { write: false })).stale.length, 3);
	await assert.rejects(readFile(join(root, GENERATED_COMPARISON_DIRECTORY, 'index.md')), { code: 'ENOENT' });
	await generateComparisonDocuments(root);
	assert.deepEqual((await generateComparisonDocuments(root)).stale, []);
	await writeFile(join(root, COMPARISON_SOURCE), fixture.replaceAll('Other Editor<br>2.0', 'New Editor'));
	await generateComparisonDocuments(root);
	await assert.rejects(readFile(join(root, GENERATED_COMPARISON_DIRECTORY, 'soundscaper-vs-other-editor.md')), { code: 'ENOENT' });
});
