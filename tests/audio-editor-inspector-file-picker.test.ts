/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The editor's file pickers, and the retry they have to survive.
 *
 * A file input raises `change` only when its value changes, so a picker left
 * holding the previous selection silently ignores the same file being chosen
 * again. That is the retry someone makes after an import reports a failure, and
 * two Inspector pickers used to drop it: the macro importer never cleared its
 * control, and the effect-preset importer cleared it only once an import had
 * already succeeded.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	takeSelectedFile,
	takeSelectedFiles,
} from '../src/common/editor/ui/file-input-selection.ts';

function picker(names: readonly string[], value = 'C:\\fakepath\\chosen'): {
	files: { name: string }[];
	value: string;
} {
	return { files: names.map((name) => ({ name })), value };
}

test('reading a picker hands back the selection and re-arms the control', () => {
	const input = picker(['first.txt', 'second.txt']);

	const files = takeSelectedFiles(input as unknown as HTMLInputElement);

	assert.deepEqual(files.map(({ name }) => name), ['first.txt', 'second.txt']);
	assert.equal(input.value, '', 'an unchanged value raises no second change event');
});

test('a picker is re-armed even when the import that follows it fails', async () => {
	const input = picker(['broken.json']);
	const attempts: string[] = [];
	const importPreset = async (file: File | null): Promise<void> => {
		if (!file) return;
		attempts.push(file.name);
		throw new Error('The preset is not valid JSON.');
	};

	await assert.rejects(importPreset(takeSelectedFile(input as unknown as HTMLInputElement)));
	assert.equal(input.value, '', 'the retry after a failed import must still raise change');

	input.files = [{ name: 'broken.json' }];
	input.value = 'C:\\fakepath\\chosen';
	await assert.rejects(importPreset(takeSelectedFile(input as unknown as HTMLInputElement)));
	assert.deepEqual(attempts, ['broken.json', 'broken.json']);
});

test('an empty picker yields nothing and still clears', () => {
	const empty = picker([]);
	assert.equal(takeSelectedFile(empty as unknown as HTMLInputElement), null);
	assert.equal(empty.value, '');
});
