/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { mkdir, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { app, utilityProcess } from 'electron/main';

import { startTracktionUtilitySession } from '../../../desktop/tracktion-utility-session.ts';

const executableFlag = '--tracktion-peer=';
const binary = process.argv.find((value) => value.startsWith(executableFlag))?.slice(executableFlag.length);
if (!binary) throw new Error('Pass --tracktion-peer with the built executable path.');

void run(binary).catch((error: unknown) => {
	console.error(error);
	app.exit(1);
});

async function run(binaryPath: string): Promise<void> {
	const scratch = mkdtempSync(join(tmpdir(), 'soundscaper-tracktion-electron-'));
	let exitCode = 0;
	const userData = join(scratch, 'electron');
	mkdirSync(userData);
	app.setPath('userData', userData);

	try {
		await app.whenReady();
		const executable = await realpath(binaryPath);
		const entry = resolve(import.meta.dirname, '../../../desktop/tracktion-utility-process.ts');
		const projectDirectory = join(scratch, 'project');
		const stateDirectory = join(scratch, 'settings');
		const exchangeDirectory = join(scratch, 'exchange');
		await Promise.all([
			mkdir(join(exchangeDirectory, 'input'), { recursive: true }),
			mkdir(join(exchangeDirectory, 'output'), { recursive: true }),
		]);
		const peer = await startTracktionUtilitySession(utilityProcess.fork, entry, {
			executable, mode: 'create', sampleRate: 48_000, projectDirectory, stateDirectory, exchangeDirectory,
		});
		try {
			const first = await peer.request({ kind: 'project', offset: 0 });
			assert.equal(first.revision, 0);
			assert.equal(first.tracks.length, 1);
			const inserted = await peer.request({ kind: 'addTrack', revision: 0, name: 'Utility process track' });
			assert.equal(inserted.revision, 1);
			await assert.rejects(peer.request({ kind: 'undo', revision: 0 }), /revision/u);
			const edited = await peer.request({ kind: 'project', offset: 0 });
			assert.equal(edited.tracks[1]?.name, 'Utility process track');
			await peer.request({ kind: 'save', revision: 1 });
			assert.ok((await stat(join(projectDirectory, 'project.tracktionedit'))).isFile());
		} finally {
			await peer.close();
		}
		console.log('Electron main and utility process completed a Tracktion edit and save.');
	} catch (error) {
		console.error(error);
		exitCode = 1;
	} finally {
		await rm(scratch, { recursive: true, force: true });
		app.exit(exitCode);
	}
}
