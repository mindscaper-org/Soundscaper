/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { TracktionRejectedCommand } from '../../../desktop/tracktion-peer-contract.ts';
import { launchTracktionPeer } from '../../../desktop/tracktion-peer.ts';
import { readTracktionProjectRequest } from '../../../desktop/tracktion-project-request.ts';
import { TracktionProjectService } from '../../../desktop/tracktion-project-service.ts';
import { exerciseInterruptedExport } from './export_peer_fixture.ts';
import { writeFileSizeLimitedPeer } from './file-size-limited-peer-fixture.ts';
import { waveData, wavFixture } from './wave_fixture.ts';

const executable = process.env.SOUNDSCAPER_TRACKTION_TEST_PEER;
if (!executable) throw new Error('Run the Tracktion render test through CTest.');

test('a short Tracktion WAV write preserves the destination and the live Edit', { skip: process.platform !== 'linux' }, async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-short-render-'));
	const limited = join(root, 'limited-peer');
	const project = join(root, 'project');
	const source = join(root, 'source.wav');
	const output = join(root, 'mix.wav');
	const originalAudio = wavFixture(200_000);
	const owner = {};
	let exchange: string | undefined;
	const service = new TracktionProjectService({
		scratchRoot: join(root, 'scratch'), isOwnerCurrent: (caller) => caller === owner,
		chooseCreateDirectory: async () => project, chooseOpenProject: async () => null,
		chooseWave: async () => source, chooseExport: async () => output,
		startPeer: async (options) => {
			exchange = options.exchangeDirectory;
			return launchTracktionPeer({ ...options, executable: limited });
		},
	});
	try {
		await mkdir(project);
		await writeFileSizeLimitedPeer(limited);
		await writeFile(source, originalAudio);
		const opened = await service.request(owner, { kind: 'create', sampleRate: 48_000 });
		assert.ok(opened && 'sessionId' in opened && exchange);
		const { sessionId } = opened;
		const [track] = opened.project.tracks;
		assert.ok(track);
		const imported = await service.request(owner, { kind: 'import', sessionId, trackId: track.id, revision: 0, start: 0 });
		assert.ok(imported && 'itemId' in imported && imported.itemId);
		const added = await service.request(owner, { kind: 'duplicateClip', sessionId, revision: imported.revision,
			trackId: track.id, clipId: imported.itemId, start: 200_000 });
		assert.ok(added && 'itemId' in added && added.itemId);
		const witness = await service.request(owner, { kind: 'addTrack', sessionId, revision: added.revision, name: 'Redo witness' });
		assert.ok(witness && 'itemId' in witness);
		const undone = await service.request(owner, { kind: 'undo', sessionId, revision: witness.revision });
		assert.ok(undone && 'itemId' in undone);
		const page = { kind: 'project', sessionId, offset: 0 } as const;
		const before = await service.request(owner, page);
		assert.ok(before && 'tracks' in before && before.canUndo && before.canRedo);
		const full = { kind: 'render', sessionId, revision: before.revision } as const;
		await service.request(owner, { ...full, start: 0, end: 10_000 });
		const previous = await readFile(output);
		const previousPcm = waveData(previous);
		assert.deepEqual(previousPcm, waveData(originalAudio).subarray(0, 10_000 * 4));
		const headerBytes = previous.length - previousPcm.length;
		const firstUnwritableFrame = Math.floor((1024 * 1024 - headerBytes) / 4) + 1;

		for (const request of [full, { ...full, start: 0, end: firstUnwritableFrame }]) {
			let refusal: unknown;
			await service.request(owner, request).catch((error: unknown) => { refusal = error; });
			const attempted = await readFile(output);
			assert.equal(attempted.length, previous.length, 'A short render must preserve the previous export.');
			assert.deepEqual(attempted, previous);
			assert.ok(refusal instanceof TracktionRejectedCommand);
			assert.match(refusal.message, /complete WAV export/u);
			assert.deepEqual(await readdir(join(exchange, 'output')), []);
			assert.deepEqual(await service.request(owner, page), before);
		}

		const redone = await service.request(owner, { kind: 'redo', sessionId, revision: before.revision });
		assert.ok(redone && 'itemId' in redone);
		const after = await service.request(owner, page);
		assert.ok(after && 'tracks' in after);
		assert.equal(after.tracks[1]?.name, 'Redo witness');
		const removed = await service.request(owner, { kind: 'deleteClip', sessionId, revision: after.revision, clipId: added.itemId });
		assert.ok(removed && 'itemId' in removed);
		await service.request(owner, { ...full, revision: removed.revision });
		assert.deepEqual(waveData(await readFile(output)), waveData(originalAudio));
		assert.deepEqual(await readdir(join(exchange, 'output')), []);
	} finally {
		try { await service.dispose(); }
		finally { await rm(root, { recursive: true, force: true }); }
	}
});

test('desktop Tracktion WAV export refuses unavailable project media and retries with exact PCM', async () => {
	const { reference, retried, source } = await exerciseInterruptedExport(executable, 'render');
	const pcm = waveData(retried);
	assert.deepEqual(pcm, waveData(reference));
	assert.deepEqual(pcm.subarray(0, 64 * 4), Buffer.alloc(64 * 4));
	assert.deepEqual(pcm.subarray(64 * 4), waveData(source));
});

test('Tracktion exports a persisted reversed wave from a cold detached Edit', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-reversed-render-'));
	const projectDirectory = join(root, 'project');
	const exchangeDirectory = join(root, 'exchange');
	const edit = join(projectDirectory, 'project.tracktionedit');
	const input = join(exchangeDirectory, 'input');
	const output = join(exchangeDirectory, 'output');
	const launch = { executable, projectDirectory, exchangeDirectory, stateDirectory: join(root, 'settings') };
	const asset = '1'.repeat(32);
	const frames = 4800;
	const start = 5760;
	const wave = wavFixture(frames);
	for (let frame = 0; frame < frames; frame += 1) {
		wave.writeInt16LE(4096 + frame, 44 + frame * 4);
		wave.writeInt16LE(-2048 - frame, 46 + frame * 4);
	}
	try {
		await Promise.all([mkdir(input, { recursive: true }), mkdir(output, { recursive: true })]);
		await writeFile(join(input, `${asset}.wav`), wave);
		const created = launchTracktionPeer({ ...launch, mode: 'create', sampleRate: 48_000 });
		try {
			const [track] = (await created.request({ kind: 'project', offset: 0 })).tracks;
			assert.ok(track);
			const clip = await created.request({ kind: 'importFile', revision: 0, trackId: track.id, asset, name: 'Source', start: 0 });
			assert.ok(clip.itemId);
			await created.request({ kind: 'duplicateClip', revision: 1, trackId: track.id, clipId: clip.itemId, start });
			await created.request({ kind: 'save', revision: 2 });
		} finally { await created.close(); }
		let waves = 0;
		const authored = (await readFile(edit, 'utf8')).replace(/<AUDIOCLIP\b/gu, (tag) => ++waves === 2 ? `${tag} isReversed="1"` : tag);
		assert.equal(waves, 2);
		await writeFile(edit, authored);
		const forward = waveData(wave);
		const reversed = Buffer.alloc(forward.length);
		for (let frame = 0; frame < frames; frame += 1)
			forward.copy(reversed, frame * 4, (frames - 1 - frame) * 4, (frames - frame) * 4);

		const peer = launchTracktionPeer({ ...launch, mode: 'open' });
		try {
			const project = { kind: 'project', offset: 0 } as const;
			const before = await peer.request(project);
			assert.equal(before.tracks[0]?.clipCount, 2);
			const render = { kind: 'render', revision: 0 } as const;
			const whole = '2'.repeat(32);
			await peer.request({ ...render, asset: whole });
			const pcm = waveData(await readFile(join(output, `${whole}.wav`)));
			assert.equal(pcm.length, (start + frames) * 4);
			assert.ok(pcm.subarray(0, start * 4).equals(Buffer.concat([forward, Buffer.alloc((start - frames) * 4)])));
			assert.ok(pcm.subarray(start * 4).equals(reversed), 'The reversed clip must retain its reversed stereo PCM.');

			const slice = '3'.repeat(32);
			await peer.request({ ...render, asset: slice, start: start + 64, end: start + 257 });
			assert.ok(waveData(await readFile(join(output, `${slice}.wav`))).equals(reversed.subarray(64 * 4, 257 * 4)));
			assert.deepEqual(await peer.request(project), before);
		} finally { await peer.close(); }

		if (process.platform === 'linux') {
			const limited = join(root, 'limited-peer');
			await writeFileSizeLimitedPeer(limited, 2);
			const constrained = launchTracktionPeer({ ...launch, executable: limited, mode: 'open' });
			try {
				const project = { kind: 'project', offset: 0 } as const;
				const before = await constrained.request(project);
				const files = (await readdir(output)).sort();
				await assert.rejects(constrained.request({
					kind: 'render', revision: 0, asset: '4'.repeat(32), start, end: start + 64,
				}), /could not render a reversed clip source/u);
				assert.deepEqual((await readdir(output)).sort(), files);
				assert.deepEqual(await constrained.request(project), before);
			} finally { await constrained.close(); }
		}
		const media = join(projectDirectory, 'media');
		const owned = await readdir(media);
		assert.equal(owned.length, 1);
		assert.ok(owned[0] && (await readFile(join(media, owned[0]))).equals(wave));
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('a Tracktion whole mix uses the last audio clip and matches explicit range PCM', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-mix-'));
	const exchangeDirectory = join(root, 'exchange');
	const source = '1'.repeat(32);
	try {
		await mkdir(join(exchangeDirectory, 'input'), { recursive: true });
		await mkdir(join(exchangeDirectory, 'output'));
		await writeFile(join(exchangeDirectory, 'input', `${source}.wav`), wavFixture());
		const peer = launchTracktionPeer({ executable, mode: 'create', sampleRate: 48_000, exchangeDirectory,
			projectDirectory: join(root, 'project'), stateDirectory: join(root, 'settings') });
		try {
			const [first] = (await peer.request({ kind: 'project', offset: 0 })).tracks;
			assert.ok(first);
			const { itemId: lastTrack } = await peer.request({ kind: 'addTrack', revision: 0, name: 'Later track' });
			assert.ok(lastTrack);
			await peer.request({ kind: 'import', revision: 1, trackId: first.id, name: 'First clip', asset: source,
				start: 31, sourceOffset: 5, frames: 53 });
			await peer.request({ kind: 'setAutomationPoint', revision: 2, trackId: first.id, parameter: 'gainDb',
				index: null, frame: 1024, value: 0, curve: 0 });
			await peer.request({ kind: 'import', revision: 3, trackId: lastTrack, name: 'Last clip', asset: source,
				start: 537, sourceOffset: 7, frames: 56 });
			const whole = '2'.repeat(32);
			const range = '3'.repeat(32);
			await peer.request({ kind: 'render', revision: 4, asset: whole });
			await peer.request({ kind: 'render', revision: 4, asset: range, start: 0, end: 593 });
			const readPcm = async (asset: string) => waveData(await readFile(join(exchangeDirectory, 'output', `${asset}.wav`)));
			const pcm = await readPcm(whole);
			assert.equal(pcm.length, 593 * 4);
			assert.equal(pcm.readInt16LE(50 * 4), 4096);
			assert.equal(pcm.readInt16LE(100 * 4), 0);
			assert.equal(pcm.readInt16LE(557 * 4), 4096);
			assert.deepEqual(pcm, await readPcm(range));
			await peer.request({ kind: 'undo', revision: 4 });
			const shortened = '4'.repeat(32);
			await peer.request({ kind: 'render', revision: 5, asset: shortened });
			assert.equal((await readPcm(shortened)).length, 84 * 4, 'whole mix reacts to edits and excludes later automation');
		} finally { await peer.close(); }
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('desktop Tracktion render requests require either both bounds or neither', () => {
	const mix = { kind: 'render', revision: 2, sessionId: '1'.repeat(32) } as const;
	const range = { ...mix, start: 4, end: 8 };
	assert.deepEqual(readTracktionProjectRequest(mix), mix);
	assert.deepEqual(readTracktionProjectRequest(range), range);
	assert.throws(() => readTracktionProjectRequest({ ...mix, start: 4 }), /end/u);
	assert.throws(() => readTracktionProjectRequest({ ...mix, end: 8 }), /start/u);
	assert.throws(() => readTracktionProjectRequest({ ...mix, start: 4, end: 4 }), /empty/u);
});
