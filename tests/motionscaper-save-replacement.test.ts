/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createMotionscaperFileAuthority } from '../desktop/motionscaper-file-authority.ts';
import { replaceMotionSaveFile, type MotionSaveReplacementInput } from '../desktop/motion-save-file-replacement.ts';
import { motionSaveJournalPath, readMotionSaveJournal } from '../desktop/motion-save-publication-journal.ts';
import { motionSaveReplacementForTest } from './helpers/motionscaper-native-replacement.ts';

test('native Save uses its replacement port for preparation and rollback with the exact selected identities', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'motion-replacement-port-')), path = join(directory, 'saved.mscape');
	await writeFile(path, 'previous archive');
	const replacements: MotionSaveReplacementInput[] = [];
	const files = createMotionscaperFileAuthority({ chooseOpen: async () => path, chooseSave: async () => path }, {
		replaceFile: async input => { replacements.push(input); await rename(input.source, input.destination); },
	});
	try {
		const writer = await files.beginSave({ projectId: 'motion', suggestedName: 'saved.mscape', saveAs: true }); assert.ok(writer);
		const bytes = new TextEncoder().encode('next archive'); await files.write({ token: writer.token, offset: 0, bytes });
		await files.commit({ token: writer.token, byteLength: bytes.length, phase: 'prepare' });
		assert.equal(replacements.length, 1); assert.equal(replacements[0]!.destination, path);
		assert.equal(replacements[0]!.source.startsWith(join(directory, '.saved.mscape.motionscaper-')), true);
		assert.ok(replacements[0]!.expected); assert.notEqual(replacements[0]!.candidate.ino, replacements[0]!.expected.ino);
		assert.equal(await readFile(path, 'utf8'), 'next archive');
		await files.cancel({ token: writer.token });
		assert.equal(replacements.length, 3); assert.equal(replacements[1]!.destination, path);
		assert.deepEqual(replacements[1]!.parent, replacements[0]!.parent);
		assert.equal(replacements[1]!.expected!.ino, replacements[0]!.candidate.ino);
		assert.notEqual(replacements[1]!.candidate.ino, replacements[0]!.expected.ino);
		assert.equal(await readFile(path, 'utf8'), 'previous archive');
	} finally { await files.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test('a refused replacement retains the prior archive and cancellation removes only its own candidate', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'motion-refused-replacement-')), path = join(directory, 'saved.mscape');
	await writeFile(path, 'previous archive'); let calls = 0;
	const files = createMotionscaperFileAuthority({ chooseOpen: async () => path, chooseSave: async () => path }, {
		replaceFile: async input => { calls++; if (input.destination === path) throw new Error('Native replacement refused'); await rename(input.source, input.destination); },
	});
	try {
		const writer = await files.beginSave({ projectId: 'motion', suggestedName: 'saved.mscape', saveAs: true }); assert.ok(writer);
		const bytes = new TextEncoder().encode('next archive'); await files.write({ token: writer.token, offset: 0, bytes });
		await assert.rejects(files.commit({ token: writer.token, byteLength: bytes.length, phase: 'prepare' }), /Native replacement refused/u);
		assert.equal(calls, 1); assert.equal(await readFile(path, 'utf8'), 'previous archive');
		await files.cancel({ token: writer.token }); assert.equal(calls, 2);
		assert.equal(await readFile(path, 'utf8'), 'previous archive');
	} finally { await files.dispose(); await rm(directory, { recursive: true, force: true }); }
});

for (const refuse of [false, true]) test(`selected-path restart recovery uses its own replacement port and preserves a refused fence: ${refuse}`, async () => {
	const directory = await mkdtemp(join(tmpdir(), 'motion-recovery-replacement-')), path = join(directory, 'saved.mscape');
	await writeFile(path, 'previous archive'); const dialogs = { chooseOpen: async () => path, chooseSave: async () => path };
	const first = createMotionscaperFileAuthority(dialogs); let calls = 0;
	const restarted = createMotionscaperFileAuthority(dialogs, { replaceFile: async input => {
		calls++; if (refuse) throw new Error('Native recovery replacement refused');
		await rename(input.source, input.destination);
	} });
	try {
		const writer = await first.beginSave({ projectId: 'motion', suggestedName: 'saved.mscape', saveAs: true }); assert.ok(writer);
		const bytes = new TextEncoder().encode('next archive'); await first.write({ token: writer.token, offset: 0, bytes });
		await first.commit({ token: writer.token, byteLength: bytes.length, phase: 'prepare' });
		if (refuse) {
			await assert.rejects(restarted.selectOpen(), /Native recovery replacement refused/u);
			assert.equal(await readFile(path, 'utf8'), 'next archive');
			await first.cancel({ token: writer.token });
		} else {
			const selected = await restarted.selectOpen(); assert.ok(selected);
			assert.equal(selected.recoveredPublication?.publication, 'rolled-back'); await restarted.release({ token: selected.token });
		}
		assert.equal(calls, refuse ? 1 : 2); assert.equal(await readFile(path, 'utf8'), 'previous archive');
	} finally { await restarted.dispose(); await first.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test('publication replaces an independently pinned pending journal through the native port without changing its old reader bytes', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'motion-pinned-journal-')), path = join(directory, 'saved.mscape');
	await writeFile(path, 'previous archive'); const replacements: MotionSaveReplacementInput[] = [];
	const backend = await motionSaveReplacementForTest();
	const files = createMotionscaperFileAuthority({ chooseOpen: async () => path, chooseSave: async () => path }, {
		replaceFile: async input => { replacements.push(input); await replaceMotionSaveFile(input, backend); },
	});
	try {
		const writer = await files.beginSave({ projectId: 'motion', suggestedName: 'saved.mscape', saveAs: true }); assert.ok(writer);
		const bytes = new TextEncoder().encode('next archive'); await files.write({ token: writer.token, offset: 0, bytes });
		await files.commit({ token: writer.token, byteLength: bytes.length, phase: 'prepare' });
		const journalPath = motionSaveJournalPath(path), pinned = await open(journalPath, 'r');
		try {
			const original = await readFile(journalPath, 'utf8'); assert.equal((await readMotionSaveJournal(path))?.journal.phase, 'pending');
			assert.equal((await files.commit({ token: writer.token, byteLength: bytes.length, phase: 'publish' })).publication, 'published');
			assert.equal(await pinned.readFile('utf8'), original);
			assert.equal((await readMotionSaveJournal(path))?.journal.phase, 'published');
			assert.equal(replacements.filter(value => value.destination === journalPath).length, 1);
		} finally { await pinned.close(); }
	} finally { await files.dispose(); await rm(directory, { recursive: true, force: true }); }
});
