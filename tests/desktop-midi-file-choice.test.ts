/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptsFile, mimeTypeForPath, validateFileChoice, validateSaveChoice } from '../desktop/validation.js';
import { readProfileForSelectedPath } from '../desktop/read-selection-service.js';

test('desktop shared Import and Open admit MIDI and Allegro through bounded selected-range reads', () => {
	for (const extension of ['mid', 'midi', 'gro']) {
		const path = `/tmp/notes.${extension.toUpperCase()}`;
		for (const purpose of ['project', 'media']) {
			assert.equal(acceptsFile(purpose, path), true, `${purpose}: ${extension}`);
			assert.ok(validateFileChoice({ purpose }).filters.some((filter: { extensions: readonly string[] }) => filter.extensions.includes(extension)));
			assert.equal(readProfileForSelectedPath(purpose, path), 'selected-range-v1');
		}
		assert.equal(acceptsFile('audio', path), false, 'PCM-only importers retain their format boundary');
		assert.equal(acceptsFile('audio-video', path), false, 'the project-bin media picker retains its format boundary');
		assert.equal(mimeTypeForPath(path), extension === 'gro' ? 'text/plain' : 'audio/midi');
	}
});

test('desktop Export other interchange filters retain MIDI and Allegro suffixes', () => {
	for (const extension of ['mid', 'midi', 'gro']) {
		const choice = validateSaveChoice({ purpose: 'interchange', suggestedName: `notes.${extension}` });
		assert.equal(choice.suggestedName, `notes.${extension}`);
		assert.ok(choice.filters.some((filter: { extensions: readonly string[] }) => filter.extensions.includes(extension)));
	}
});
