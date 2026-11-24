/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { app, type BrowserWindow } from 'electron/main';

import { openTracktionWindow, registerTracktionScheme } from '../../../desktop/tracktion-window.ts';
import type { TracktionProjectCommand, TracktionProjectReply } from '../../../src/soundscaper/tracktion-project-contract.ts';
import { writeAlsaOutputFixture } from './alsa_fixture.ts';
import { wavFixture } from './wave_fixture.ts';

const executableFlag = '--tracktion-peer=';
const binary = process.argv.find((value) => value.startsWith(executableFlag))?.slice(executableFlag.length);
if (!binary) throw new Error('Pass --tracktion-peer with the built executable path.');
const rendererFlag = '--tracktion-editor=';
const renderer = process.argv.find((value) => value.startsWith(rendererFlag))?.slice(rendererFlag.length);
if (!renderer) throw new Error('Pass --tracktion-editor with the built renderer directory.');

registerTracktionScheme();
void run(binary, renderer).catch((error: unknown) => {
	console.error(error);
	app.exit(1);
});

async function run(binaryPath: string, bundleRoot: string): Promise<void> {
	const scratch = mkdtempSync(join(tmpdir(), 'soundscaper-tracktion-electron-'));
	const userData = join(scratch, 'electron');
	mkdirSync(userData);
	app.setPath('userData', userData);
	app.setPath('sessionData', userData);
	app.on('window-all-closed', () => undefined);

	let exitCode = 0;
	let editor: Awaited<ReturnType<typeof openTracktionWindow>> | undefined;
	try {
		await app.whenReady();
		const projectDirectory = join(scratch, 'Project');
		const projectFile = join(projectDirectory, 'project.tracktionedit');
		const wave = join(scratch, 'Reference.wav');
		const output = join(scratch, 'Mix.wav');
		const archive = join(scratch, 'Project.zip');
		await mkdir(projectDirectory);
		await writeFile(wave, wavFixture());
		if (process.platform === 'linux') {
			process.env.ALSA_CONFIG_PATH = join(scratch, 'alsa.conf');
			await writeAlsaOutputFixture(process.env.ALSA_CONFIG_PATH, join(scratch, 'output.raw'));
		}
		editor = await openTracktionWindow({
			bundleRoot, peer: binaryPath, scratchRoot: join(scratch, 'sessions'),
			show: false,
			dialogs: {
				chooseCreateDirectory: async () => projectDirectory,
				chooseOpenProject: async () => projectFile,
				chooseWave: async () => wave,
				chooseExport: async (kind) => kind === 'wav' ? output : archive,
			},
		});
		assert.equal(new URL(editor.window.webContents.getURL()).protocol, 'soundscaper-tracktion-app:');
		assert.equal(await editor.window.webContents.executeJavaScript('typeof require'), 'undefined');
		await runRendererWorkflow(editor.window, { scratch, projectFile, output, archive });
		await runEditorWorkflow(editor.window);
		console.log('The Electron renderer created, edited, saved, exported and reopened a Tracktion project.');
	} catch (error) {
		console.error(error);
		exitCode = 1;
	} finally {
		try {
			editor?.window.destroy();
			await editor?.dispose();
			await rm(scratch, { recursive: true, force: true, maxRetries: 3 });
		} catch (error) {
			console.error(error);
			exitCode = 1;
		} finally {
			app.exit(exitCode);
		}
	}
}

async function runEditorWorkflow(window: BrowserWindow): Promise<void> {
	async function click(label: string): Promise<void> {
		await window.webContents.executeJavaScript(`
			Array.from(document.querySelectorAll('button, summary'))
				.find((candidate) => candidate.textContent.trim() === ${JSON.stringify(label)}).click()
		`);
	}
	async function waitForVisible(text: string): Promise<void> {
		await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('Text did not appear')), 5000);
			const poll = setInterval(() => {
				if (document.body.innerText.includes(${JSON.stringify(text)})) {
					clearTimeout(timer);
					clearInterval(poll);
					resolve();
				}
			}, 25);
		})`);
	}

	await waitForVisible('File');
	await click('File');
	await click('Open projects');
	await waitForVisible('Reference');
	await click('File');
	await click('Import audio');
	await waitForVisible('3 clips');
	await click('File');
	await click('Save project');
	await waitForVisible('All changes saved locally');
	if (process.platform === 'linux') {
		await click('Playback and recording');
		await click('Play');
		await waitForVisible('Playing');
		await click('Playback and recording');
		await click('Stop');
		await waitForVisible('Stopped');
	}
}

async function runRendererWorkflow(
	window: BrowserWindow,
	paths: { scratch: string; projectFile: string; output: string; archive: string },
): Promise<void> {
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
