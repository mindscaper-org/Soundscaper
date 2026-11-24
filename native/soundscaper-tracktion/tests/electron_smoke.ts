/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { app, utilityProcess, type BrowserWindow } from 'electron/main';

import { startTracktionUtilitySession } from '../../../desktop/tracktion-utility-session.ts';
import type { TracktionPluginLibrary } from '../../../desktop/tracktion-plugin-library.ts';
import { openTracktionWindow, registerTracktionScheme } from '../../../desktop/tracktion-window.ts';
import type { TracktionProjectCommand, TracktionProjectReply } from '../../../src/soundscaper/tracktion-project-contract.ts';
import { writeAlsaCaptureFixture } from './alsa_fixture.ts';
import {
	removePipeWireFixtureSink, removePipeWireFixtureSource, restorePipeWireFixtureSink, restorePipeWireFixtureSource,
} from './pipewire_fixture.ts';
import { waveData, wavFixture } from './wave_fixture.ts';

const executableFlag = '--tracktion-peer=';
const binary = process.argv.find((value) => value.startsWith(executableFlag))?.slice(executableFlag.length);
if (!binary) throw new Error('Pass --tracktion-peer with the built executable path.');
const rendererFlag = '--tracktion-editor=';
const renderer = process.argv.find((value) => value.startsWith(rendererFlag))?.slice(rendererFlag.length);
if (!renderer) throw new Error('Pass --tracktion-editor with the built renderer directory.');
const scratchFlag = '--tracktion-scratch=';
const scratch = process.argv.find((value) => value.startsWith(scratchFlag))?.slice(scratchFlag.length);
if (!scratch) throw new Error('Start the editor smoke with run_electron_smoke.mjs.');

registerTracktionScheme();
void run(binary, renderer, scratch).catch((error: unknown) => {
	console.error(error);
	app.exit(1);
});

async function run(binaryPath: string, bundleRoot: string, scratch: string): Promise<void> {
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
		const pluginLibrary = testPluginLibrary();
		await mkdir(projectDirectory);
		await writeFile(wave, wavFixture());
		if (process.platform === 'linux') {
			process.env.ALSA_CONFIG_PATH = join(scratch, 'alsa.conf');
			await writeAlsaCaptureFixture(process.env.ALSA_CONFIG_PATH, join(scratch, 'input.raw'));
		}
		editor = await openTracktionWindow({
			bundleRoot, peer: binaryPath, scratchRoot: join(scratch, 'sessions'),
			pluginLibrary,
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
		await runEditorWorkflow(editor.window, sessionId, output);
		await verifyUtilityEffect(binaryPath, scratch);
		console.log('The Electron renderer created, edited, saved, exported and reopened a Tracktion project.');
	} catch (error) {
		console.error(error);
		exitCode = 1;
	} finally {
		try {
			editor?.window.destroy();
			await editor?.dispose();
		} catch (error) {
			console.error(error);
			exitCode = 1;
		} finally {
			app.exit(exitCode);
		}
	}
}

function testPluginLibrary(): TracktionPluginLibrary {
	const identity = { format: 'clap', stableId: 'org.soundscaper.fixture.tracktion-gain', sha256: 'b'.repeat(64) };
	const installation = { id: 'i' + 'c'.repeat(15), name: 'Test Gain', vendor: 'Soundscaper', format: 'clap' };
	let found = false;
	let allowed = false;
	return {
		async catalog() { return found ? [{ ...installation, allowed }] : []; },
		async scan() { found = true; return [{ ...installation, allowed }]; },
		async select(id) { assert.ok(found && id === installation.id); allowed = true; return identity; },
		async openStereo(effect) {
			assert.ok(allowed);
			assert.deepEqual(effect, identity);
			return {
				latencyFrames: 0,
				async process(input, output) { input.forEach((plane, i) => output[i]!.set(plane.map((sample) => sample * 2))); },
				async close() {},
			};
		},
	};
}

async function verifyUtilityEffect(executable: string, scratch: string): Promise<void> {
	const exchangeDirectory = join(scratch, 'effect-exchange');
	const asset = 'a'.repeat(32);
	const identity = { format: 'clap', stableId: 'org.soundscaper.fixture.gain', sha256: 'b'.repeat(64) };
	await mkdir(join(exchangeDirectory, 'input'), { recursive: true });
	await mkdir(join(exchangeDirectory, 'output'));
	await writeFile(join(exchangeDirectory, 'input', `${asset}.wav`), wavFixture(256));
	let released = false;
	const peer = await startTracktionUtilitySession(utilityProcess.fork,
		resolve(import.meta.dirname, '../../../desktop/tracktion-utility-process.ts'), {
			executable, exchangeDirectory, mode: 'create', sampleRate: 48_000,
			projectDirectory: join(scratch, 'effect-project'), stateDirectory: join(scratch, 'effect-state'),
		}, {
			async openStereo(request) {
				assert.deepEqual(request, identity);
				return {
					latencyFrames: 0,
					async process(input, output) {
						output[0].set(input[0].map((sample) => sample * 2));
						output[1].set(input[1].map((sample) => sample * 2));
					},
					async close() { released = true; },
				};
			},
		});
	try {
		const track = (await peer.request({ kind: 'project', offset: 0 })).tracks[0];
		assert.ok(track);
		await peer.request({ kind: 'importFile', revision: 0, trackId: track.id, asset, name: 'Effect input', start: 0 });
		await peer.request({ kind: 'insertOfflineEffect', revision: 1, trackId: track.id, ...identity });
		await peer.request({ kind: 'render', revision: 2, start: 0, end: 256, asset });
		const pcm = waveData(await readFile(join(exchangeDirectory, 'output', `${asset}.wav`)));
		assert.equal(pcm.readInt16LE(128 * 4), 8192);
		assert.equal(pcm.readInt16LE(128 * 4 + 2), -4096);
		assert.equal(released, true);
	} finally {
		await peer.close();
	}
}

async function requestFromEditor<Command extends TracktionProjectCommand>(
	window: BrowserWindow, command: Command,
): Promise<TracktionProjectReply<Command>> {
	return await window.webContents.executeJavaScript(
		`globalThis.soundscaperTracktion.request(${JSON.stringify(command)})`,
	) as TracktionProjectReply<Command>;
}

async function runEditorWorkflow(window: BrowserWindow, sessionId: string, output: string): Promise<void> {
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
	await click('Editing tools');
	await click('Offline track effects');
	await waitForVisible('No stereo plug-ins found.');
	await click('Scan allowed plug-in folders');
	await waitForVisible('Test Gain');
	await click('Review and add effect');
	await waitFor('document.querySelector("dialog[open]") === null');
	const effected = await requestFromEditor(window, { kind: 'project', sessionId, offset: 0 });
	const effectedTrack = effected.tracks[0];
	assert.ok(effectedTrack);
	const activeEffects = await requestFromEditor(window, { kind: 'offlineEffects', sessionId, revision: effected.revision, trackId: effectedTrack.id, offset: 0 });
	assert.equal(activeEffects.slots.length, 1);
	await assert.rejects(requestFromEditor(window, { kind: 'addOfflineEffect', sessionId, revision: effected.revision,
		trackId: effectedTrack.id, installationId: 'i' + 'c'.repeat(15), path: output } as const), /unsupported field/u);
	await click('File');
	await click('Export mix (WAV)');
	await waitFor('true');
	assert.ok(waveData(await readFile(output)).includes(Buffer.from([0, 32, 0, 240])));
	await click('Editing tools');
	await click('Offline track effects');
	await waitForVisible('Remove effect');
	await click('Remove effect');
	await waitFor('document.querySelector("dialog[open]") === null');
	const removed = await requestFromEditor(window, { kind: 'project', sessionId, offset: 0 });
	assert.equal(removed.revision, effected.revision + 1);
	assert.equal((await requestFromEditor(window, { kind: 'offlineEffects', sessionId, revision: removed.revision,
		trackId: effectedTrack.id, offset: 0 })).slots.length, 0);
	await click('File');
	await click('Save project');
	await waitForVisible('All changes saved locally');
	if (process.platform === 'win32' && process.env.SOUNDSCAPER_TRACKTION_TEST_ASIO === '1') {
		await click('Playback and recording');
		await click('Audio setup');
		await waitFor('document.querySelector("dialog[open] select[name=hostId]:enabled") !== null');
		await window.webContents.executeJavaScript(`
			const host = document.querySelector('dialog[open] select[name=hostId]');
			const asio = Array.from(host.options).find((entry) => entry.textContent === 'ASIO');
			if (!asio) throw new Error('Audio setup did not list the Windows ASIO host');
			host.value = asio.value;
			host.dispatchEvent(new Event('change', { bubbles: true }));
		`);
		await waitFor('document.querySelectorAll("dialog[open] select[name=outputId] option").length > 1'
			+ ' && document.querySelector("dialog[open] select[name=inputId]") === null');
		await click('Cancel');
	}
	if (process.platform === 'linux') {
		await click('Playback and recording');
		await click('Audio setup');
		await waitFor('document.querySelector("dialog[open] select[name=outputId]") !== null');
		const testMissingMicrophone = process.env.SOUNDSCAPER_TRACKTION_TEST_PIPEWIRE === '1';
		const testMissingSpeakers = process.env.SOUNDSCAPER_TRACKTION_TEST_PIPEWIRE_OUTPUT === '1';
		if (testMissingMicrophone || testMissingSpeakers) {
			await window.webContents.executeJavaScript(`
				for (const [field, label] of [['inputId', 'tracktion.test.microphone'], ['outputId', 'tracktion.test.speakers']]) {
					const select = document.querySelector('dialog[open] select[name=' + field + ']');
					const option = Array.from(select.options).find((entry) => entry.textContent === label);
					if (!option) throw new Error('Missing named PipeWire fixture ' + label);
					select.value = option.value;
				}
			`);
		}
		await click('Apply');
		await waitFor('document.querySelector("dialog[open]") === null');
		const audioSetup = (await requestFromEditor(window, { kind: 'audioHosts', sessionId })).selected;
		assert.ok(audioSetup);
		assert.equal(audioSetup.actualSampleRate, 48_000);
		await click('Playback and recording');
		await click('Play');
		await waitForVisible('Playing');
		if (testMissingSpeakers) {
			await sleep(150);
			removePipeWireFixtureSink();
			await waitForVisible('The selected audio device disconnected');
			restorePipeWireFixtureSink();
			await click('Playback and recording');
			await click('Play');
			await waitForVisible('Playing');
		}
		await click('Playback and recording');
		await click('Stop');
		await waitForVisible('Stopped');
		await click('Playback and recording');
		await click('Jump to project start');
		await waitForVisible('Stopped');
		await click('Playback and recording');
		await click('Record onto the active track');
		await waitForVisible('Recording');
		if (testMissingMicrophone) {
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
		if (testMissingSpeakers) {
			removePipeWireFixtureSink();
			// A fresh source node keeps this test independent of audiotestsrc's reconnection behavior.
			removePipeWireFixtureSource();
			restorePipeWireFixtureSource();
		}
		const reopened = await requestFromEditor(window, { kind: 'open' });
		assert.ok(reopened);
		const prior = await requestFromEditor(window, { kind: 'audioHosts', sessionId: reopened.sessionId });
		assert.equal(prior.selected, null);
		assert.deepEqual(prior.preferred, audioSetup.setup);
		if (testMissingSpeakers) {
			await assert.rejects(requestFromEditor(window, { kind: 'prepareOutput', sessionId: reopened.sessionId }), /unavailable/u);
			await click('File');
			await click('Open projects');
			await waitForVisible('4 clips');
			await click('Playback and recording');
			await click('Record onto the active track');
			await waitForVisible('Recording');
			await waitForVisible('The selected audio device disconnected');
			await sleep(250);
			await click('Playback and recording');
			await click('Stop');
			await waitForVisible('5 clips');
			restorePipeWireFixtureSink();
		}
		await requestFromEditor(window, { kind: 'prepareOutput', sessionId: reopened.sessionId });
		const resumed = await requestFromEditor(window, { kind: 'audioHosts', sessionId: reopened.sessionId });
		assert.deepEqual(resumed.selected?.setup, audioSetup.setup);
		if (testMissingMicrophone) {
			const { tracks, revision } = reopened.project;
			const track = tracks[0];
			assert.ok(track);
			const record = { kind: 'startRecording', sessionId: reopened.sessionId, revision, trackId: track.id, frame: 0 } as const;
			const devices = await requestFromEditor(window, { kind: 'audioDevices', sessionId: reopened.sessionId, hostId: audioSetup.setup.hostId });
			assert.ok(devices.inputs.some(({ name }) => name === 'tracktion.test.recovery-microphone'));
			await assert.rejects(requestFromEditor(window, { kind: 'setAudioSetup', sessionId: reopened.sessionId, ...audioSetup.setup }), /unavailable/u);
			await assert.rejects(requestFromEditor(window, record), /unavailable/u);
			assert.equal((await requestFromEditor(window, { kind: 'play', sessionId: reopened.sessionId, frame: 0 })).playing, true);
			await requestFromEditor(window, { kind: 'stop', sessionId: reopened.sessionId });
			restorePipeWireFixtureSource();
			assert.equal((await requestFromEditor(window, record)).recording, true);
			await sleep(220);
			const take = await requestFromEditor(window, { kind: 'finishRecording', sessionId: reopened.sessionId, revision, discard: false });
			assert.ok(take.itemId, 'the saved name can record again when the same device returns');
		}
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
