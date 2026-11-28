/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { tracktionAudioPreferences } from '../desktop/tracktion-audio-preferences.ts';
import { TracktionRejectedCommand, type TracktionCommand, type TracktionReply } from '../desktop/tracktion-peer-contract.ts';
import { TracktionProjectService } from '../desktop/tracktion-project-service.ts';
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

void test('Tracktion reports a live setup whose preferences could not be saved and permits a retry', async () => {
	const root = await mkdtemp(join(tmpdir(), 'tracktion-audio-preferences-live-'));
	const project = join(root, 'project');
	const edit = join(project, 'project.tracktionedit');
	const owner = {};
	const applied = { setup: replacement, actualSampleRate: replacement.sampleRate, actualBlockSize: replacement.blockSize };
	let rejectSetup = true;
	let rejectWrite = true;
	let stored = setup;
	let writes = 0;
	const service = new TracktionProjectService({
		scratchRoot: join(root, 'scratch'), isOwnerCurrent: (caller) => caller === owner,
		chooseCreateDirectory: async () => null, chooseOpenProject: async () => edit,
		chooseWave: async () => null, chooseExport: async () => null,
		audioPreferences: {
			async read() { return stored; },
			async write(value) {
				writes += 1;
				if (rejectWrite) throw new Error('Preference path is read-only.');
				stored = value;
			},
		},
		startPeer: async () => ({
			async request<Command extends TracktionCommand>(command: Command): Promise<TracktionReply<Command>> {
				if (command.kind === 'project') {
					const reply = { revision: 0, sampleRate: 48_000, tracks: [], nextOffset: null, canUndo: false, canRedo: false };
					return reply as unknown as TracktionReply<Command>;
				}
				assert.equal(command.kind, 'setAudioSetup');
				if (rejectSetup) throw new TracktionRejectedCommand('The selected audio device could not open.');
				return applied as unknown as TracktionReply<Command>;
			},
			async close() {},
		}),
	});
	try {
		await mkdir(project);
		await writeFile(edit, '');
		const opened = await service.request(owner, { kind: 'open' });
		assert.ok(opened && 'sessionId' in opened);
		const command = { kind: 'setAudioSetup', sessionId: opened.sessionId, ...replacement } as const;
		await assert.rejects(service.request(owner, command), /selected audio device could not open/u);
		assert.equal(writes, 0);
		rejectSetup = false;
		assert.deepEqual(await service.request(owner, command), { ...applied, preferencesSaved: false });
		assert.equal(writes, 1);
		assert.deepEqual(stored, setup);
		rejectWrite = false;
		assert.deepEqual(await service.request(owner, command), applied);
		assert.equal(writes, 2);
		assert.deepEqual(stored, replacement);
	} finally {
		try { await service.dispose(); }
		finally { await rm(root, { recursive: true, force: true }); }
	}
});
