/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { app, BrowserWindow, ipcMain, utilityProcess } from 'electron/main';

import { createTrustedDesktopIpc } from '../../../desktop/main-trusted-ipc.ts';
import { registerTracktionProjectIpc } from '../../../desktop/tracktion-project-ipc.ts';
import { TracktionProjectService } from '../../../desktop/tracktion-project-service.ts';
import { startTracktionUtilitySession } from '../../../desktop/tracktion-utility-session.ts';
import type { TracktionProjectCommand, TracktionProjectReply } from '../../../src/soundscaper/tracktion-project-contract.ts';
import { wavFixture } from './wave_fixture.ts';

const executableFlag = '--tracktion-peer=';
const binary = process.argv.find((value) => value.startsWith(executableFlag))?.slice(executableFlag.length);
if (!binary) throw new Error('Pass --tracktion-peer with the built executable path.');

void run(binary).catch((error: unknown) => {
	console.error(error);
	app.exit(1);
});

async function run(binaryPath: string): Promise<void> {
	const scratch = mkdtempSync(join(tmpdir(), 'soundscaper-tracktion-electron-'));
	const userData = join(scratch, 'electron');
	mkdirSync(userData);
	app.setPath('userData', userData);
	app.on('window-all-closed', () => undefined);

	let exitCode = 0;
	let window: BrowserWindow | undefined;
	let service: TracktionProjectService | undefined;
	try {
		await app.whenReady();
		const executable = await realpath(binaryPath);
		const entry = resolve(import.meta.dirname, '../../../desktop/tracktion-utility-process.ts');
		const projectDirectory = join(scratch, 'Project');
		const projectFile = join(projectDirectory, 'project.tracktionedit');
		const wave = join(scratch, 'Reference.wav');
		const output = join(scratch, 'Mix.wav');
		const archive = join(scratch, 'Project.zip');
		await mkdir(projectDirectory);
		await writeFile(wave, wavFixture());
		window = new BrowserWindow({
			show: false,
			webPreferences: {
				preload: resolve(import.meta.dirname, '../../../desktop/tracktion-preload.cjs'),
				contextIsolation: true, sandbox: true, nodeIntegration: false, partition: 'tracktion-smoke',
			},
		});

		const owner = {};
		const url = 'data:text/html;charset=utf-8,Tracktion';
		const { handle } = createTrustedDesktopIpc({
			ipcMain, windowFor: () => window ?? null,
			assertDocumentUrl: (sender) => { assert.equal(sender, url); },
		});
		service = new TracktionProjectService({
			scratchRoot: join(scratch, 'sessions'),
			isOwnerCurrent: (candidate) => candidate === owner,
			chooseCreateDirectory: async () => projectDirectory,
			chooseOpenProject: async () => projectFile,
			chooseWave: async () => wave,
			chooseExport: async (kind) => kind === 'wav' ? output : archive,
			startPeer: (launch) => startTracktionUtilitySession(utilityProcess.fork, entry, { ...launch, executable }),
		});
		registerTracktionProjectIpc({ handle, ownerFor: () => owner, service });
		await runRendererWorkflow(window, url, { scratch, projectFile, output, archive });
		console.log('The Electron renderer created, edited, saved, exported and reopened a Tracktion project.');
	} catch (error) {
		console.error(error);
		exitCode = 1;
	} finally {
		try {
			await service?.dispose();
			window?.destroy();
			await rm(scratch, { recursive: true, force: true, maxRetries: 3 });
		} catch (error) {
			console.error(error);
			exitCode = 1;
		} finally {
			app.exit(exitCode);
		}
	}
}

async function runRendererWorkflow(
	window: BrowserWindow, url: string,
	paths: { scratch: string; projectFile: string; output: string; archive: string },
): Promise<void> {
	await window.loadURL(url);
	async function send<Command extends TracktionProjectCommand>(command: Command): Promise<TracktionProjectReply<Command>> {
		return await window.webContents.executeJavaScript(
			`globalThis.soundscaperTracktion.request(${JSON.stringify(command)})`,
		) as TracktionProjectReply<Command>;
	}

	const opened = await send({ kind: 'create', sampleRate: 48_000 });
	assert.ok(opened);
	const { sessionId, project } = opened;
	assert.equal(opened.name, 'Project');
	assert.equal(project.revision, 0);
	assert.ok(!JSON.stringify(opened).includes(paths.scratch));
	const track = project.tracks[0];
	assert.ok(track);
	assert.equal(project.tracks.length, 1);

	const imported = await send({ kind: 'import', sessionId, revision: 0, trackId: track.id, start: 3 });
	assert.ok(imported?.itemId);
	assert.equal(imported.revision, 1);
	const clips = await send({ kind: 'clips', sessionId, revision: 1, trackId: track.id, offset: 0 });
	assert.deepEqual(clips.clips, [{ id: imported.itemId, name: 'Reference', start: 3, end: 67, sourceOffset: 0 }]);
	await assert.rejects(send({ kind: 'undo', sessionId, revision: 0 }), /revision/u);

	const forged = { kind: 'import', sessionId, revision: 1, trackId: track.id, start: 0, path: paths.projectFile } as const;
	await assert.rejects(send(forged), /unsupported field/u);

	const split = await send({ kind: 'split', sessionId, revision: 1, clipId: imported.itemId, frame: 24 });
	assert.ok(split.itemId);
	await send({ kind: 'save', sessionId, revision: 2 });
	assert.ok((await stat(paths.projectFile)).isFile());
	await send({ kind: 'render', sessionId, revision: 2, start: 0, end: 68 });
	await send({ kind: 'archive', sessionId, revision: 2 });
	const wave = await readFile(paths.output);
	assert.equal(wave.subarray(0, 4).toString(), 'RIFF');
	assert.ok(wave.includes(Buffer.from([0, 16, 0, 248])));
	assert.deepEqual((await readFile(paths.archive)).subarray(0, 4), Buffer.from([0x50, 0x4b, 3, 4]));

	await send({ kind: 'close', sessionId });
	const reopened = await send({ kind: 'open' });
	assert.ok(reopened);
	assert.notEqual(reopened.sessionId, sessionId);
	assert.equal(reopened.project.tracks[0]?.clipCount, 2);
	await assert.rejects(send({ kind: 'project', sessionId, offset: 0 }), /expired/u);
}
