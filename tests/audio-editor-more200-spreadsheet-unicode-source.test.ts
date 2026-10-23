/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { matchClipSpreadsheetSourceFiles } from '../src/common/editor/ui/clip-spreadsheet/paste.ts';

for (const form of ['NFC', 'NFD'] as const) {
	for (const prefix of ['', '/recordings/', 'file:///recordings/']) test(`spreadsheet resolves a unique ${form} file from a canonically equivalent ${prefix || 'literal'} reference`, () => {
		const name = 'Été.wav';
		const reference = prefix + name.normalize(form === 'NFC' ? 'NFD' : 'NFC');
		const file = { name: name.normalize(form) };
		assert.equal(matchClipSpreadsheetSourceFiles([reference], [file]).get(reference), file);
	});
}

test('exact Unicode filename matches retain precedence over canonical siblings', () => {
	const exact = { name: 'Été.wav' };
	const sibling = { name: exact.name.normalize('NFD') };
	const result = matchClipSpreadsheetSourceFiles([exact.name, sibling.name], [exact, sibling]);
	assert.equal(result.get(exact.name), exact);
	assert.equal(result.get(sibling.name), sibling);
});

test('canonical filename fallback refuses distinct granted paths instead of picking arbitrary PCM', () => {
	const name = 'Été.wav'.normalize('NFD');
	assert.throws(() => matchClipSpreadsheetSourceFiles(['/missing/Été.wav'], [
		{ name, relativePath: `first/${name}` }, { name, relativePath: `second/${name}` },
	]), /ambiguous/u);
});

test('canonical matching keeps filename edge spaces, case and different accents distinct', () => {
	for (const name of [' été.wav ', 'été.wav', 'Èté.wav']) {
		assert.throws(() => matchClipSpreadsheetSourceFiles(['Été.wav'], [{ name }]), /missing/u);
	}
});

test('canonical path identity takes priority over an unrelated exact basename', () => {
	const name = 'Été.wav';
	const intended = { name: name.normalize('NFD'), relativePath: `wanted/${name.normalize('NFD')}` };
	const other = { name, relativePath: `other/${name}` };
	const matched = matchClipSpreadsheetSourceFiles([`wanted/${name}`, `other/${name}`], [intended, other]);
	assert.equal(matched.get(`wanted/${name}`), intended);
	assert.equal(matched.get(`other/${name}`), other);
});
