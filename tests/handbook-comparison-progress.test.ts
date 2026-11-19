import assert from 'node:assert/strict';
import test from 'node:test';

import { createVerdictLedger, parseVerdictRow, passedRowCount, rankVerdictColumns } from '../handbook/src/comparison/verdict-counts.ts';
import rehypeComparisonSummary from '../handbook/src/plugins/rehype-comparison-summary.mjs';

test('running verdict counts accumulate across sections and support scrolling backwards', () => {
	const ledger = createVerdictLedger(['+/', '~+', '/~'].map(row => parseVerdictRow(row, 2)), 2);
	assert.deepEqual(ledger[0], [
		{ yes: 0, partial: 0, no: 0, unknown: 0 }, { yes: 0, partial: 0, no: 0, unknown: 0 },
	]);
	assert.deepEqual(ledger[3], [
		{ yes: 1, partial: 1, no: 1, unknown: 0 }, { yes: 1, partial: 1, no: 1, unknown: 0 },
	]);
	assert.deepEqual(ledger[1], [
		{ yes: 1, partial: 0, no: 0, unknown: 0 }, { yes: 0, partial: 0, no: 1, unknown: 0 },
	]);
});

test('unverified cells remain separate and malformed rows cannot silently alter totals', () => {
	assert.deepEqual(createVerdictLedger([parseVerdictRow('?', 1)], 1)[1], [{ yes: 0, partial: 0, no: 0, unknown: 1 }]);
	assert.throws(() => parseVerdictRow('+/', 3), /column count/u);
	assert.throws(() => parseVerdictRow('x', 1), /verdict/u);
	assert.throws(() => createVerdictLedger([['yes']], 2), /column count/u);
});

test('a row counts exactly when its bottom passes the header, including jumps and reverse scrolling', () => {
	const bottoms = [140, 220, 310, 310, 480];
	assert.equal(passedRowCount(bottoms, 139), 0);
	assert.equal(passedRowCount(bottoms, 220), 2);
	assert.equal(passedRowCount(bottoms, 310), 4);
	assert.equal(passedRowCount(bottoms, 600), 5);
	assert.equal(passedRowCount(bottoms, 141), 1);
	assert.equal(passedRowCount([], 600), 0);
});

test('capability order prioritises support, breaks ties with limited support, and preserves equal ranks', () => {
	const counts = [
		{ yes: 2, partial: 1, no: 3, unknown: 0 },
		{ yes: 3, partial: 0, no: 3, unknown: 0 },
		{ yes: 2, partial: 2, no: 2, unknown: 0 },
		{ yes: 2, partial: 2, no: 0, unknown: 2 },
	];
	assert.deepEqual(rankVerdictColumns(counts), [1, 2, 3, 0]);
});

type Node = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: Node[] };
const element = (tagName: string, properties: Record<string, unknown> = {}, children: Node[] = []): Node => ({ type: 'element', tagName, properties, children });
const text = (value: string): Node => ({ type: 'text', value });
const marker = (): Node => ({ type: 'raw', value: '<!-- comparison-summary -->' });
const findAll = (node: Node, predicate: (node: Node) => boolean): Node[] => [
	...(predicate(node) ? [node] : []), ...(node.children ?? []).flatMap(child => findAll(child, predicate)),
];
const comparison = (states: string[][]): Node => element('table', { className: ['verdict-table', 'comparison-table--grouped'] }, [
	element('thead', {}, [element('tr', {}, ['Editor', 'Composer'].map(name => element('th', { scope: 'col' }, [text(name)])))]),
	element('tbody', {}, states.map(row => element('tr', {}, [
		element('th', {}, [text('Example capability')]),
		...row.map(state => element('td', { className: ['verdict-cell', `verdict-cell--${state}`] }, [text('Explanations may contain +, ~, or /.') ])),
	]))),
]);

test('summary charts and header counters derive from verdicts across tables, never tooltip prose', () => {
	const first = comparison([['yes', 'no'], ['partial', 'yes']]);
	const second = comparison([['no', 'partial']]);
	const tree: Node = { type: 'root', children: [first, second, marker()] };
	rehypeComparisonSummary()(tree);
	assert.deepEqual(findAll(tree, node => Boolean(node.properties?.dataComparisonVerdicts)).map(node => node.properties?.dataComparisonVerdicts), ['+/', '~+', '/~']);
	const charts = findAll(tree, node => node.tagName === 'figure');
	assert.equal(charts.length, 2);
	assert.ok(charts.every(chart => findAll(chart, node => node.properties?.role === 'img').some(node => /1 supported, 1 limited, 1 unavailable/u.test(String(node.properties?.ariaLabel)))));
	assert.equal(findAll(first, node => Boolean(node.properties?.dataComparisonCounter)).length, 2);
	assert.equal(findAll(second, node => Boolean(node.properties?.dataComparisonCounter)).length, 0);
	const snapshot = JSON.stringify(tree);
	rehypeComparisonSummary()(tree);
	assert.equal(JSON.stringify(tree), snapshot);
});

test('ordinary pages keep their tables and mismatched product columns fail instead of miscounting', () => {
	const ordinary: Node = { type: 'root', children: [element('table'), marker()] };
	const snapshot = JSON.stringify(ordinary);
	rehypeComparisonSummary()(ordinary);
	assert.equal(JSON.stringify(ordinary), snapshot);
	const wrong = comparison([['yes']]);
	assert.throws(() => rehypeComparisonSummary()({ type: 'root', children: [wrong, marker()] }), /column count/u);
});
