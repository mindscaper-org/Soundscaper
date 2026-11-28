/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { tracktionAudioPreferences } from '../desktop/tracktion-audio-preferences.ts';
import type { TracktionAudioSetup } from '../src/soundscaper/tracktion-audio-device-contract.ts';

const setup: TracktionAudioSetup = {
	hostId: '1'.repeat(16), outputId: '2'.repeat(16), inputId: '3'.repeat(16),
	inputChannel: 0, outputChannel: 0, sampleRate: 48_000, blockSize: 256,
};
const replacement = { ...setup, outputId: '', inputId: '', blockSize: 512 };
const permissionTests = { skip: process.platform === 'win32' || process.getuid?.() === 0 };

void test('unreadable Tracktion audio preferences can be ignored and replaced explicitly', permissionTests, async () => {
	const directory = await mkdtemp(join(tmpdir(), 'tracktion-audio-preferences-read-'));
	const path = join(directory, 'audio.json');
	const preferences = tracktionAudioPreferences(path);
	try {
		await preferences.write(setup);
		const previous = await readFile(path);
		await chmod(path, 0o000);
		try { assert.equal(await preferences.read(), null); }
		finally { await chmod(path, 0o600); }
		assert.deepEqual(await readFile(path), previous);
		assert.deepEqual(await preferences.read(), setup);

		await chmod(path, 0o000);
		await preferences.write(replacement);
		assert.deepEqual(await preferences.read(), replacement);
		assert.deepEqual(await readdir(directory), ['audio.json']);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

void test('a denied Tracktion audio preference replacement keeps the previous valid selection', permissionTests, async () => {
	const directory = await mkdtemp(join(tmpdir(), 'tracktion-audio-preferences-write-'));
	const path = join(directory, 'audio.json');
	const preferences = tracktionAudioPreferences(path);
	try {
		await preferences.write(setup);
		const previous = await readFile(path);
		await chmod(directory, 0o500);
		try { await assert.rejects(preferences.write(replacement), { code: 'EACCES' }); }
		finally { await chmod(directory, 0o700); }
		assert.deepEqual(await readFile(path), previous);
		assert.deepEqual(await preferences.read(), setup);
		assert.deepEqual(await readdir(directory), ['audio.json']);
		await preferences.write(replacement);
		assert.deepEqual(await preferences.read(), replacement);
	} finally { await rm(directory, { recursive: true, force: true }); }
});
