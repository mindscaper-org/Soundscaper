/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { matchClipSpreadsheetSourceFiles } from '../src/common/editor/ui/clip-spreadsheet/paste.ts';

test('absolute POSIX paths and file URLs preserve literal backslashes in granted filenames', () => {
	const file = new File(['recording'], 'Take\\one.wav');
	for (const reference of ['/recordings/Take\\one.wav', 'file:///recordings/Take%5Cone.wav']) {
		assert.equal(matchClipSpreadsheetSourceFiles([reference], [file]).get(reference), file);
	}
});

test('Windows paths still recognize backslashes as separators', () => {
	const file = new File(['recording'], 'Take.wav');
	for (const reference of ['C:\\recordings\\Take.wav', '\\\\studio\\recordings\\Take.wav', 'recordings\\Take.wav']) {
		assert.equal(matchClipSpreadsheetSourceFiles([reference], [file]).get(reference), file);
	}
});
