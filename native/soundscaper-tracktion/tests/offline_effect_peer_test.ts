/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { createTracktionOfflineRender, type TracktionOfflineEffectHost } from '../../../desktop/tracktion-offline-effects.ts';
import { launchTracktionPeer } from '../../../desktop/tracktion-peer.ts';
import { writeAlsaOutputFixture } from './alsa_fixture.ts';
import { waveData, wavFixture } from './wave_fixture.ts';

const executable = process.env.SOUNDSCAPER_TRACKTION_TEST_PEER;
if (!executable) throw new Error('Run the Tracktion effect regression through CTest.');

const effect = { format: 'clap', stableId: 'org.soundscaper.fixture.gain', sha256: 'a'.repeat(64) };
const gainFixture = `
	const lines = require('node:readline').createInterface({ input: process.stdin });
	lines.on('line', (line) => {
		const { samples, fail } = JSON.parse(line);
		if (fail) process.exit(1);
		const output = samples.map(plane => plane.map(sample => sample * 2));
		process.stdout.write(JSON.stringify({ pid: process.pid, samples: output }) + '\\n');
	});
`;

test('the Tracktion peer renders an admitted effect through a separate process and releases it on refusal', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-effect-'));
	const exchangeDirectory = join(root, 'exchange');
	const options = { executable, projectDirectory: join(root, 'edit'), stateDirectory: join(root, 'state'), exchangeDirectory };
	const asset = '1'.repeat(32);
	const opens: string[] = [];
	const closes: string[] = [];
	let blockCount = 0;
	let refuse = false;
	const host: TracktionOfflineEffectHost = {
		async openStereo(identity, rate, maximumFrames) {
			assert.deepEqual(identity, effect);
			assert.equal(rate, 48_000);
			assert.equal(maximumFrames, 128);
			opens.push(identity.sha256);
			const child = spawn(process.execPath, ['-e', gainFixture], { windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'] });
			child.on('error', () => { child.stdout.destroy(); });
			child.stdin.on('error', () => { child.stdout.destroy(); });
			const done = new Promise<void>((resolve) => { child.once('close', () => resolve()); });
			const lines = createInterface({ input: child.stdout });
			const answers = lines[Symbol.asyncIterator]();
			return {
				latencyFrames: 0,
				async process(input, output) {
					blockCount += 1;
					child.stdin.write(`${JSON.stringify({ fail: refuse, samples: input.map((plane) => [...plane]) })}\n`);
					const answer = await answers.next();
					if (answer.done) throw new Error('The gain fixture process stopped.');
					const result = JSON.parse(answer.value) as { pid: number; samples: [number[], number[]] };
					assert.notEqual(result.pid, process.pid);
					assert.equal(result.pid, child.pid);
					output[0].set(result.samples[0]);
					output[1].set(result.samples[1]);
				},
				async close() {
					child.stdin.end();
					lines.close();
					await done;
					closes.push(identity.sha256);
				},
			};
		},
	};
	try {
		await mkdir(join(exchangeDirectory, 'input'), { recursive: true });
		const output = join(exchangeDirectory, 'output');
		await mkdir(output);
		await writeFile(join(exchangeDirectory, 'input', `${asset}.wav`), wavFixture(256));
		const peer = launchTracktionPeer({ ...options, mode: 'create', sampleRate: 48_000 }, () => createTracktionOfflineRender(host));
		try {
			const track = (await peer.request({ kind: 'project', offset: 0 })).tracks[0];
			assert.ok(track);
			await peer.request({ kind: 'importFile', revision: 0, trackId: track.id, asset, name: 'Effect input', start: 0 });
			const result = await peer.request({ kind: 'insertOfflineEffect', revision: 1, trackId: track.id, ...effect });
			assert.ok(result.itemId);
			await assert.rejects(peer.request({ kind: 'startRecording', revision: 2, trackId: track.id, frame: 0 }),
				/requires offline rendering/u);
			await peer.request({ kind: 'save', revision: 2 });
			const render = { kind: 'render', revision: 2, start: 0, end: 256, asset } as const;
			await peer.request(render);
			const pcm = waveData(await readFile(join(output, `${asset}.wav`)));
			assert.equal(pcm.length, 256 * 4);
			assert.equal(pcm.readInt16LE(128 * 4), 8192);
			assert.equal(pcm.readInt16LE(128 * 4 + 2), -4096);
			assert.ok(blockCount >= 2);
			assert.deepEqual(opens, [effect.sha256]);
			assert.deepEqual(closes, opens);
			refuse = true;
			await assert.rejects(peer.request({ ...render, asset: '2'.repeat(32) }), /effect failed/u);
			assert.equal((await peer.request({ kind: 'project', offset: 0 })).revision, 2);
			assert.equal(opens.length, 2);
			assert.deepEqual(closes, opens);
		} finally {
			await peer.close();
		}
		const reopened = launchTracktionPeer({ ...options, mode: 'open' });
		try {
			await assert.rejects(reopened.request({ kind: 'render', revision: 0, start: 0, end: 256, asset: '3'.repeat(32) }),
				/isolated Tracktion effect is unavailable/u);
			assert.deepEqual(await readdir(output), [`${asset}.wav`]);
		} finally {
			await reopened.close();
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('Tracktion duplicates the complete track with fresh IDs and shared media', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-track-copy-'));
	const projectDirectory = join(root, 'edit');
	const exchangeDirectory = join(root, 'exchange');
	const options = { executable, projectDirectory, exchangeDirectory, stateDirectory: join(root, 'state') };
	const asset = '2'.repeat(32);
	try {
		await mkdir(join(exchangeDirectory, 'input'), { recursive: true });
		await writeFile(join(exchangeDirectory, 'input', `${asset}.wav`), wavFixture(512));
		const peer = launchTracktionPeer({ ...options, mode: 'create', sampleRate: 48_000 });
		let copyTrackId: string;
		let copySlotId: string;
		try {
			const [source] = (await peer.request({ kind: 'project', offset: 0 })).tracks;
			assert.ok(source);
			const trackId = source.id;
			const after = await peer.request({ kind: 'addTrack', revision: 0, name: 'Other track' });
			await peer.request({ kind: 'import', revision: 1, trackId, asset, name: 'Trimmed source', start: 64, sourceOffset: 11, frames: 256 });
			await peer.request({ kind: 'setTrackMix', revision: 2, trackId, gainDb: -6, pan: 0.5, muted: false, solo: false });
			await peer.request({ kind: 'setAutomationPoint', revision: 3, trackId, parameter: 'gainDb', index: null, frame: 96, value: -12, curve: 0 });
			const slot = await peer.request({ kind: 'insertOfflineEffect', revision: 4, trackId, ...effect });
			const copy = await peer.request({ kind: 'duplicateTrack', revision: 5, trackId });
			assert.ok(copy.itemId && copy.itemId !== trackId);
			copyTrackId = copy.itemId;
			const project = await peer.request({ kind: 'project', offset: 0 });
			assert.deepEqual(project.tracks.map(({ id }) => id), [trackId, copyTrackId, after.itemId]);
			assert.equal(project.tracks[1]?.name, `${source.name} copy`);
			const clip = async (trackId: string) => (await peer.request({ kind: 'clips', revision: 6, trackId, offset: 0 })).clips[0];
			const original = await clip(trackId);
			const duplicated = await clip(copyTrackId);
			assert.ok(original && duplicated && original.id !== duplicated.id);
			assert.deepEqual({ ...duplicated, id: original.id }, original);
			const mix = (trackId: string) => peer.request({ kind: 'trackMix', revision: 6, trackId });
			assert.deepEqual(await mix(copyTrackId), await mix(trackId));
			const automation = (trackId: string) => peer.request({ kind: 'trackAutomation', revision: 6, trackId, parameter: 'gainDb', offset: 0 });
			assert.deepEqual(await automation(copyTrackId), await automation(trackId));
			const [copySlot] = (await peer.request({ kind: 'offlineEffects', revision: 6, trackId: copyTrackId, offset: 0 })).slots;
			assert.ok(copySlot && copySlot.id !== slot.itemId);
			copySlotId = copySlot.id;
			assert.equal(copySlot.name, effect.stableId);
			await peer.request({ kind: 'undo', revision: 6 });
			assert.deepEqual((await peer.request({ kind: 'project', offset: 0 })).tracks.map(({ id }) => id), [trackId, after.itemId]);
			await peer.request({ kind: 'redo', revision: 7 });
			assert.deepEqual((await peer.request({ kind: 'project', offset: 0 })).tracks, project.tracks);
			await peer.request({ kind: 'save', revision: 8 });
			assert.equal((await readdir(join(projectDirectory, 'media'))).length, 1);
		} finally { await peer.close(); }
		const reopened = launchTracktionPeer({ ...options, mode: 'open' });
		try {
			const [slot] = (await reopened.request({ kind: 'offlineEffects', revision: 0, trackId: copyTrackId, offset: 0 })).slots;
			assert.equal(slot?.id, copySlotId);
			const [clip] = (await reopened.request({ kind: 'clips', revision: 0, trackId: copyTrackId, offset: 0 })).clips;
			assert.equal(clip?.sourceOffset, 11);
		} finally { await reopened.close(); }
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('Tracktion stops live playback when history restores an offline effect', { skip: process.platform !== 'linux' }, async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-effect-history-'));
	const config = join(root, 'alsa.conf');
	const previous = process.env.ALSA_CONFIG_PATH;
	const exchangeDirectory = join(root, 'exchange');
	const asset = '3'.repeat(32);
	try {
		await writeAlsaOutputFixture(config, join(root, 'output.raw'));
		await mkdir(join(exchangeDirectory, 'input'), { recursive: true });
		await writeFile(join(exchangeDirectory, 'input', `${asset}.wav`), wavFixture(48_000));
		process.env.ALSA_CONFIG_PATH = config;
		const peer = launchTracktionPeer({ executable, mode: 'create', sampleRate: 48_000, exchangeDirectory,
			projectDirectory: join(root, 'edit'), stateDirectory: join(root, 'state') });
		try {
			const [track] = (await peer.request({ kind: 'project', offset: 0 })).tracks;
			assert.ok(track);
			const trackId = track.id;
			await peer.request({ kind: 'importFile', revision: 0, trackId, asset, name: 'Playback signal', start: 0 });
			const { itemId: slotId } = await peer.request({ kind: 'insertOfflineEffect', revision: 1, trackId, ...effect });
			assert.ok(slotId);
			await peer.request({ kind: 'removeOfflineEffect', revision: 2, trackId, slotId });
			const play = { kind: 'play', frame: 0 } as const;
			const status = { kind: 'transportStatus' } as const;
			let transport = await peer.request({ kind: 'prepareOutput' });
			for (let attempt = 0; attempt < 100 && !transport.ready; attempt += 1) {
				await sleep(10);
				transport = await peer.request(status);
			}
			assert.equal(transport.ready, true);
			assert.equal((await peer.request(play)).playing, true);
			await peer.request({ kind: 'undo', revision: 3 });
			assert.equal((await peer.request(status)).playing, false, 'undoing removal stops playback before restoring the effect');
			assert.deepEqual((await peer.request({ kind: 'offlineEffects', revision: 4, trackId, offset: 0 })).slots.map(({ id }) => id), [slotId]);
			await assert.rejects(peer.request(play), /requires offline rendering/u);

			await peer.request({ kind: 'undo', revision: 4 });
			assert.equal((await peer.request(play)).playing, true);
			await peer.request({ kind: 'redo', revision: 5 });
			assert.equal((await peer.request(status)).playing, false, 'redoing insertion stops playback before restoring the effect');
			assert.deepEqual((await peer.request({ kind: 'offlineEffects', revision: 6, trackId, offset: 0 })).slots.map(({ id }) => id), [slotId]);
			await peer.request({ kind: 'redo', revision: 6 });
			assert.equal((await peer.request(play)).playing, true, 'playback resumes once the effect is removed');
			await peer.request({ kind: 'addTrack', revision: 7, name: 'Other track' });
			await peer.request({ kind: 'undo', revision: 8 });
			assert.equal((await peer.request(status)).playing, true, 'a regular undo leaves playback active');
		} finally { await peer.close(); }
	} finally {
		if (previous === undefined) delete process.env.ALSA_CONFIG_PATH;
		else process.env.ALSA_CONFIG_PATH = previous;
		await rm(root, { recursive: true, force: true });
	}
});
