/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptsFile, validateFileChoice, validateSaveChoice } from '../desktop/validation.js';

test('desktop Open and Import admit ADLs and package pickers without treating them as audio streams', () => {
	for (const purpose of ['project', 'media']) {
		assert.equal(acceptsFile(purpose, '/sessions/voice.ADL'), true);
		assert.equal(acceptsFile(purpose, '/sessions/voice.adl.zip'), true);
		assert.equal(acceptsFile(purpose, '/sessions/unrelated.zip'), false);
		assert.ok(validateFileChoice({ purpose }).extensions.includes('adl'));
	}
	assert.equal(acceptsFile('audio-video', '/sessions/voice.adl'), false);
	assert.equal(acceptsFile('audio-video', '/sessions/voice.adl.zip'), false);
	const choice = validateSaveChoice({ purpose: 'interchange', suggestedName: 'voice.adl.zip' });
	assert.equal(choice.suggestedName, 'voice.adl.zip');
	assert.ok(choice.filters[0]!.extensions.includes('zip'));
});
