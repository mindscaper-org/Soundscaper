/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { planMsiPayload } from '../scripts/lib/desktop-msi-payload.ts';
import { extractMsiApplication } from '../scripts/lib/desktop-msi-extraction.mjs';

function fixture() {
	return { cabinets: [{ cabinet: '#cab1.cab' }],
		directories: [{ id: 'APPLICATIONFOLDER', parent: 'ProgramFiles64Folder', name: 'Soundscaper' },
			{ id: 'resources', parent: 'APPLICATIONFOLDER', name: 'RESOUR~1|resources' }],
		components: [{ id: 'main', directory: 'APPLICATIONFOLDER' }, { id: 'resource', directory: 'resources' }],
		files: [{ id: 'mainExecutable', component: 'main', name: 'SOUNDS~1.EXE|Soundscaper.exe', size: '3' },
			{ id: 'payload', component: 'resource', name: 'app.asar', size: '4' }],
	};
}
test('MSI table reconstruction resolves long names and refuses paths outside the application', () => {
	assert.deepEqual(planMsiPayload(fixture(), 'Soundscaper').files, [
		{ id: 'mainExecutable', path: 'Soundscaper.exe', size: 3 }, { id: 'payload', path: 'resources/app.asar', size: 4 },
	]);
	for (const name of ['../escape', '..', 'x:y', 'a\\b', 'name.']) {
		const data = fixture(); data.files[1]!.name = name;
		assert.throws(() => planMsiPayload(data, 'Soundscaper'), /path/u);
	}
	const outside = fixture(); outside.components[0]!.directory = 'ProgramFiles64Folder';
	assert.throws(() => planMsiPayload(outside, 'Soundscaper'), /escapes/u);
	const cycle = fixture(); cycle.directories[1]!.parent = 'resources';
	assert.throws(() => planMsiPayload(cycle, 'Soundscaper'), /Cyclic/u);
	const duplicate = fixture(); duplicate.files.push({ ...duplicate.files[0]!, id: 'other', name: 'soundscaper.exe' });
	assert.throws(() => planMsiPayload(duplicate, 'Soundscaper'), /Duplicate/u);
	const wrongRoot = fixture(); wrongRoot.directories[0]!.parent = 'LocalAppDataFolder';
	assert.throws(() => planMsiPayload(wrongRoot, 'Soundscaper'), /per-machine/u);
});

test('MSI extraction reconstructs authenticated file paths without running an installation', async context => {
	const root = await mkdtemp(join(tmpdir(), 'scape-msi-extract-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const extractedRoot = join(root, 'application');
	const commands: string[][] = [];
	const execute = async (command: string, args: readonly string[]) => {
		commands.push([command, ...args]);
		if (args.includes('-CabinetDirectory')) return { stdout: JSON.stringify(fixture()), stderr: '' };
		if (args[0] === 'l') return { stdout: 'Path = mainExecutable\nSize = 3\n\nPath = payload\nSize = 4\n', stderr: '' };
		const output = args.find(value => value.startsWith('-o'))!.slice(2);
		await mkdir(output, { recursive: true });
		await writeFile(join(output, 'mainExecutable'), 'exe'); await writeFile(join(output, 'payload'), 'asar');
		return { stdout: '', stderr: '' };
	};
	await extractMsiApplication({ artifact: join(root, 'installer.msi'), extractedRoot, sevenZip: '/tools/7z', productId: 'soundscaper' }, { execute });
	assert.equal(await readFile(join(extractedRoot, 'Soundscaper.exe'), 'utf8'), 'exe');
	assert.equal(await readFile(join(extractedRoot, 'resources/app.asar'), 'utf8'), 'asar');
	assert.equal(commands.some(args => args.some(value => /msiexec|\/a$/iu.test(value))), false);
	await assert.rejects(extractMsiApplication({ artifact: join(root, 'installer.msi'), extractedRoot: join(root, 'bad'), sevenZip: '/tools/7z', productId: 'soundscaper' }, {
		execute: async (command, args) => args.includes('-CabinetDirectory') ? { stdout: JSON.stringify(fixture()), stderr: '' }
			: { stdout: 'Path = ../escape\n', stderr: '' },
	}), /cabinet/u);
});
