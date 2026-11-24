/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { app, type BrowserWindow } from 'electron/main';

import { openTracktionWindow, registerTracktionScheme } from '../../../desktop/tracktion-window.ts';
import type { TracktionProjectCommand, TracktionProjectReply } from '../../../src/soundscaper/tracktion-project-contract.ts';
import { writeAlsaCaptureFixture } from './alsa_fixture.ts';
import { removePipeWireFixtureSource } from './pipewire_fixture.ts';
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
			await writeAlsaCaptureFixture(process.env.ALSA_CONFIG_PATH, join(scratch, 'input.raw'));
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
		const sessionId = await runRendererWorkflow(editor.window, { scratch, projectFile, output, archive });
		await runEditorWorkflow(editor.window, sessionId);
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

async function requestFromEditor<Command extends TracktionProjectCommand>(
	window: BrowserWindow, command: Command,
): Promise<TracktionProjectReply<Command>> {
	return await window.webContents.executeJavaScript(
		`globalThis.soundscaperTracktion.request(${JSON.stringify(command)})`,
	) as TracktionProjectReply<Command>;
}

async function runEditorWorkflow(window: BrowserWindow, sessionId: string): Promise<void> {
	async function click(label: string): Promise<void> {
		await window.webContents.executeJavaScript(`
			(() => {
				const label = ${JSON.stringify(label)};
				const control = Array.from(document.querySelectorAll('button, summary'))
					.find((candidate) => candidate.textContent.trim() === label);
				if (!control || control.disabled) throw new Error('Editor command is unavailable: ' + label);
				control.click();
			})()
		`);
	}
	async function waitFor(expression: string): Promise<void> {
		for (let attempt = 0; attempt < 200; attempt += 1) {
			if (await window.webContents.executeJavaScript(`
				document.querySelector('main')?.getAttribute('aria-busy') !== 'true' && (${expression})
			`)) return;
			await sleep(25);
		}
		const text = await window.webContents.executeJavaScript('document.body.innerText') as string;
		throw new Error(`Editor did not satisfy ${expression}\n${text}`);
	}
	function waitForVisible(text: string): Promise<void> {
		return waitFor(`document.body.innerText.includes(${JSON.stringify(text)})`);
	}
	function waitForTrackCount(count: number): Promise<void> {
		return waitFor(`document.querySelectorAll('main select option').length === ${count}`);
	}

	await waitForVisible('File');
	await click('File');
	await click('Open projects');
	await waitForVisible('Reference');
	await click('File');
	await click('Import audio');
	await waitForVisible('3 clips');
	await click('Editing tools');
	await click('Split clip');
	await waitFor('document.querySelector("dialog[open]") !== null');
	await click('Apply');
	await waitForVisible('4 clips');
	await click('Editing tools');
	await click('Undo');
	await waitForVisible('3 clips');
	await click('Editing tools');
	await click('Trim clip');
	await waitFor('document.querySelector("dialog[open]") !== null');
	await window.webContents.executeJavaScript('document.querySelector(\'dialog input[name="start"]\').value = "4"');
	await click('Apply');
	await waitForVisible('Reference (4–24)');
	await click('Editing tools');
	await click('Undo');
	await waitForVisible('Reference (3–24)');
	await click('Editing tools');
	await click('Add track');
	await waitForTrackCount(2);
	await click('Editing tools');
	await click('Undo');
	await waitForTrackCount(1);
	await waitForVisible('3 clips');
	await click('Editing tools');
	await click('Redo');
	await waitForTrackCount(2);
	await click('Editing tools');
	await click('Undo');
	await waitForTrackCount(1);
	await waitForVisible('3 clips');
	await click('Editing tools');
	await click('Mixer');
	await waitFor('document.querySelector("dialog[open]") !== null');
	await window.webContents.executeJavaScript('document.querySelector(\'dialog input[name="gainDb"]\').value = "-6"');
	await click('Apply');
	await waitFor('document.querySelector("dialog[open]") === null');
	const mixedProject = await requestFromEditor(window, { kind: 'project', sessionId, offset: 0 });
	const mixerTrack = mixedProject.tracks[0];
	assert.ok(mixerTrack);
	const mix = await requestFromEditor(window, { kind: 'trackMix', sessionId, revision: mixedProject.revision, trackId: mixerTrack.id });
	assert.ok(Math.abs(mix.gainDb + 6) < 0.01);
	await click('Editing tools');
	await click('Undo');
	await waitForVisible('3 clips');
	await click('File');
	await click('Save project');
	await waitForVisible('All changes saved locally');
	if (process.platform === 'linux') {
		await click('Playback and recording');
		await click('Audio setup');
		await waitFor('document.querySelector("dialog[open] select[name=outputId]") !== null');
		await click('Apply');
		await waitFor('document.querySelector("dialog[open]") === null');
		const audioSetup = (await requestFromEditor(window, { kind: 'audioHosts', sessionId })).selected;
		assert.ok(audioSetup);
		assert.equal(audioSetup.actualSampleRate, 48_000);
		await click('Playback and recording');
		await click('Play');
		await waitForVisible('Playing');
		await click('Playback and recording');
		await click('Stop');
		await waitForVisible('Stopped');
		await click('Playback and recording');
		await click('Jump to project start');
		await waitForVisible('Stopped');
		await click('Playback and recording');
		await click('Record onto the active track');
		await waitForVisible('Recording');
		if (process.env.SOUNDSCAPER_TRACKTION_TEST_PIPEWIRE === '1') {
			await sleep(280);
			removePipeWireFixtureSource();
			await waitForVisible('Recording added to the track');
		} else {
			let transport = await requestFromEditor(window, { kind: 'transportStatus', sessionId });
			for (let attempt = 0; attempt < 100 && transport.frame < 4096; attempt += 1) {
				await sleep(10);
				transport = await requestFromEditor(window, { kind: 'transportStatus', sessionId });
			}
			assert.ok(transport.recording && transport.frame >= 4096);
			await click('Playback and recording');
			await click('Stop');
		}
		await waitForVisible('4 clips');
		await click('File');
		await click('Save project');
		await waitForVisible('All changes saved locally');
		await click('File');
		await click('Close project');
		await waitForVisible('Soundscaper Tracktion');
		const reopened = await requestFromEditor(window, { kind: 'open' });
		assert.ok(reopened);
		const prior = await requestFromEditor(window, { kind: 'audioHosts', sessionId: reopened.sessionId });
		assert.equal(prior.selected, null);
		assert.deepEqual(prior.preferred, audioSetup.setup);
		await requestFromEditor(window, { kind: 'prepareOutput', sessionId: reopened.sessionId });
		const resumed = await requestFromEditor(window, { kind: 'audioHosts', sessionId: reopened.sessionId });
		assert.deepEqual(resumed.selected?.setup, audioSetup.setup);
	}
}

async function runRendererWorkflow(
	window: BrowserWindow,
	paths: { scratch: string; projectFile: string; output: string; archive: string },
): Promise<string> {
	const send = <Command extends TracktionProjectCommand>(command: Command) => requestFromEditor(window, command);

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
	return reopened.sessionId;
}
