/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { launchTracktionPeer } from '../../../desktop/tracktion-peer.ts';
import type { TracktionClipView } from '../../../src/soundscaper/tracktion-project-contract.ts';
import { writeFileSizeLimitedPeer } from './file-size-limited-peer-fixture.ts';
import { wavFixture } from './wave_fixture.ts';

const executable = process.env.SOUNDSCAPER_TRACKTION_TEST_PEER;
if (!executable) throw new Error('Run the Tracktion clipboard test through CTest.');

const longFrames = 524_288;
const shortStart = 32;
const longStart = 128;

test('Tracktion acknowledges single-track overlap Paste with its canonical ordered placements', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-paste-reply-'));
	const exchangeDirectory = join(root, 'exchange');
	const asset = 'c'.repeat(32);
	try {
		await mkdir(join(exchangeDirectory, 'input'), { recursive: true });
		await writeFile(join(exchangeDirectory, 'input', `${asset}.wav`), wavFixture());
		const peer = launchTracktionPeer({ executable, mode: 'create', sampleRate: 48_000, exchangeDirectory,
			projectDirectory: join(root, 'project'), stateDirectory: join(root, 'settings') });
		try {
			const [track] = (await peer.request({ kind: 'project', offset: 0 })).tracks;
			assert.ok(track);
			const trackId = track.id;
			const { itemId: first } = await peer.request({ kind: 'importFile', revision: 0, trackId, asset, name: 'First', start: 0 });
			const { itemId: second } = await peer.request({ kind: 'importFile', revision: 1, trackId, asset, name: 'Second', start: 32 });
			const { itemId: last } = await peer.request({ kind: 'importFile', revision: 2, trackId, asset, name: 'Last', start: 112 });
			const page = { kind: 'clips', trackId, offset: 0 } as const;
			await peer.request({ kind: 'copyRange', trackId, mode: 'leaveGap', start: 0, end: 96, revision: 3 });
			const paste = { kind: 'pasteRange', trackId, start: 32 } as const;
			const result = await peer.request({ ...paste, mode: 'overlap', revision: 3 });
			const { clips } = await peer.request({ ...page, revision: 4 });
			const originalIds = new Set([first, second, last]);
			const acknowledged = clips.flatMap((clip, index) => originalIds.has(clip.id) ? [] : [{ clip, index }]);
			assert.deepEqual(acknowledged.map(({ clip: { name, start, end, sourceOffset }, index }) => [name, start, end, sourceOffset, index]),
				[['First', 32, 96, 0, 2], ['Second', 64, 128, 0, 3]]);
			assert.deepEqual(result, { revision: 4, itemId: null, history: { canUndo: true, canRedo: false }, pastedClips: acknowledged });
			assert.deepEqual(await peer.request({ ...paste, mode: 'insertTracks', revision: 4 }), { revision: 5, itemId: null });
			const { itemId: otherTrack } = await peer.request({ kind: 'addTrack', name: 'Other lane', revision: 5 });
			assert.ok(otherTrack);
			await peer.request({ kind: 'importFile', trackId: otherTrack, revision: 6, asset, name: 'Other audio', start: 0 });
			await peer.request({ kind: 'copyRange', trackId: null, mode: 'allTracks', start: 0, end: 64, revision: 7 });
			assert.deepEqual(await peer.request({ ...paste, mode: 'overlap', start: 512, revision: 7 }), { revision: 8, itemId: null });
			const other = await peer.request({ ...page, trackId: otherTrack, revision: 8 });
			assert.deepEqual(other.clips.map(({ start, end }) => [start, end]), [[0, 64], [512, 576]]);
		} finally { await peer.close(); }
	} finally { await rm(root, { recursive: true, force: true }); }
});

async function prepareSizeLimitedClipboard(root: string, peerPath: string) {
	const projectDirectory = join(root, 'project');
	const exchangeDirectory = join(root, 'exchange');
	const clipboardDirectory = join(root, 'clipboard');
	const launch = { executable: peerPath, projectDirectory, exchangeDirectory, clipboardDirectory, stateDirectory: join(root, 'state') };
	const limitedPeer = join(root, 'limited-peer');
	await writeFileSizeLimitedPeer(limitedPeer);
	await mkdir(join(exchangeDirectory, 'input'), { recursive: true });
	const large = 'a'.repeat(32);
	const small = 'b'.repeat(32);
	await writeFile(join(exchangeDirectory, 'input', `${large}.wav`), wavFixture(longFrames));
	await writeFile(join(exchangeDirectory, 'input', `${small}.wav`), wavFixture());
	const peer = launchTracktionPeer({ ...launch, mode: 'create', sampleRate: 48_000 });
	try {
		const [track] = (await peer.request({ kind: 'project', offset: 0 })).tracks;
		assert.ok(track);
		const trackId = track.id;
		await peer.request({ kind: 'importFile', revision: 0, trackId, asset: large, name: 'Large', start: longStart });
		await peer.request({ kind: 'importFile', revision: 1, trackId, asset: small, name: 'Small', start: shortStart });
		await peer.request({ kind: 'save', revision: 2 });
		return { launch, limitedPeer, trackId };
	} finally { await peer.close(); }
}

test('Tracktion Cut keeps the source and prior clipboard if a media write fails', { skip: process.platform !== 'linux' }, async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-cut-limit-'));
	try {
		const { launch, limitedPeer, trackId } = await prepareSizeLimitedClipboard(root, executable);
		const peer = launchTracktionPeer({ ...launch, executable: limitedPeer, mode: 'open' });
		try {
			const page = { kind: 'project', offset: 0 } as const;
			const clips = { kind: 'clips', revision: 0, trackId, offset: 0 } as const;
			const before = await peer.request(page);
			const source = await peer.request(clips);
			await peer.request({ kind: 'copyRange', revision: 0, trackId, mode: 'leaveGap', start: shortStart, end: shortStart + 64 });
			const selection = join(launch.clipboardDirectory, 'selection.xml');
			const previousClipboard = await readFile(selection);
			const previousFiles = (await readdir(launch.clipboardDirectory)).sort();
			await assert.rejects(peer.request({ kind: 'cutRange', revision: 0, trackId, mode: 'leaveGap', start: longStart, end: longStart + longFrames }),
				/Cannot preserve Tracktion clipboard media/u);
			assert.deepEqual(await peer.request(page), before);
			assert.deepEqual(await peer.request(clips), source);
			assert.deepEqual(await readFile(selection), previousClipboard);
			assert.deepEqual((await readdir(launch.clipboardDirectory)).sort(), previousFiles);
			await peer.request({ kind: 'pasteRange', revision: 0, trackId, mode: 'overlap', start: 600_000 });
			const pasted = (await peer.request({ ...clips, revision: 1 })).clips.at(-1);
			assert.ok(pasted);
			assert.deepEqual([pasted.name, pasted.start, pasted.end], ['Small', 600_000, 600_064]);
		} finally { await peer.close(); }
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('Tracktion Cut preserves the Edit and clipboard when writing the selection is incomplete', { skip: process.platform !== 'linux' }, async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-cut-metadata-'));
	const limited = join(root, 'limited-peer');
	const clipboardDirectory = join(root, 'clipboard');
	const exchangeDirectory = join(root, 'exchange');
	const asset = 'd'.repeat(32);
	try {
		await mkdir(join(exchangeDirectory, 'input'), { recursive: true });
		await writeFile(join(exchangeDirectory, 'input', `${asset}.wav`), wavFixture());
		await writeFileSizeLimitedPeer(limited, 2);
		const peer = launchTracktionPeer({ executable: limited, projectDirectory: join(root, 'project'), exchangeDirectory,
			clipboardDirectory, stateDirectory: join(root, 'state'), mode: 'create', sampleRate: 48_000 });
		try {
			const project = { kind: 'project', offset: 0 } as const;
			const [track] = (await peer.request(project)).tracks;
			assert.ok(track);
			const scope = { trackId: track.id, mode: 'leaveGap', start: 0 } as const;
			const imported = await peer.request({ kind: 'importFile', revision: 0, trackId: track.id, name: 'Source PCM', asset, start: 0 });
			assert.ok(imported.itemId);
			await peer.request({ ...scope, kind: 'copyRange', revision: imported.revision, end: 64 });
			const selection = join(clipboardDirectory, 'selection.xml');
			const previous = await readFile(selection);
			assert.ok(previous.length < 2048);
			const previousFiles = (await readdir(clipboardDirectory)).sort();
			let revision = imported.revision;
			for (let index = 1; index < 10; index += 1) {
				({ revision } = await peer.request({ kind: 'duplicateClip', revision, trackId: track.id, clipId: imported.itemId, start: index * 128 }));
			}
			({ revision } = await peer.request({ kind: 'addTrack', revision, name: 'Redo witness' }));
			({ revision } = await peer.request({ kind: 'undo', revision }));
			const before = await peer.request(project);
			assert.ok(before.canUndo && before.canRedo);
			const clipPage = { kind: 'clips', revision, trackId: track.id, offset: 0 } as const;
			const clips = await peer.request(clipPage);
			assert.equal(clips.clips.length, 10);
			let refusal: unknown;
			await peer.request({ ...scope, kind: 'cutRange', revision, end: 1280 }).catch((error: unknown) => { refusal = error; });
			const kept = await readFile(selection);
			assert.equal(kept.length, previous.length, 'An incomplete Cut must preserve the previous clipboard.');
			assert.deepEqual(kept, previous);
			assert.ok(refusal instanceof Error);
			assert.match(refusal.message, /clipboard selection could not be staged/u);
			assert.deepEqual(await peer.request(project), before);
			assert.deepEqual(await peer.request(clipPage), clips);
			assert.deepEqual((await readdir(clipboardDirectory)).sort(), previousFiles);
			({ revision } = await peer.request({ kind: 'redo', revision }));
			assert.equal((await peer.request(project)).tracks[1]?.name, 'Redo witness');
			({ revision } = await peer.request({ kind: 'pasteRange', revision, trackId: track.id, mode: 'overlap', start: 4096 }));
			const pasted = (await peer.request({ ...clipPage, revision })).clips.at(-1);
			assert.ok(pasted);
			assert.deepEqual([pasted.name, pasted.start, pasted.end], ['Source PCM', 4096, 4160]);
		} finally { await peer.close(); }
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('Tracktion Cut keeps the Edit and prior clipboard when clipboard storage cannot be created', {
	skip: process.platform === 'win32' || process.getuid?.() === 0,
}, async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-clipboard-outage-'));
	const exchangeDirectory = join(root, 'exchange');
	const clipboardDirectory = join(root, 'clipboard');
	const selection = join(clipboardDirectory, 'selection.xml');
	const asset = 'a'.repeat(32);
	try {
		await mkdir(join(exchangeDirectory, 'input'), { recursive: true });
		await writeFile(join(exchangeDirectory, 'input', `${asset}.wav`), wavFixture());
		const peer = launchTracktionPeer({ executable, mode: 'create', sampleRate: 48_000, exchangeDirectory,
			clipboardDirectory, projectDirectory: join(root, 'project'), stateDirectory: join(root, 'state') });
		try {
			const project = { kind: 'project', offset: 0 } as const;
			const [track] = (await peer.request(project)).tracks;
			assert.ok(track);
			const trackId = track.id;
			const imported = await peer.request({ kind: 'importFile', revision: 0, trackId, asset, name: 'Source', start: 0 });
			assert.ok(imported.itemId);
			await peer.request({ kind: 'save', revision: imported.revision });
			await peer.request({ kind: 'copyRange', revision: imported.revision, trackId, mode: 'leaveGap', start: 0, end: 64 });
			const previousClipboard = await readFile(selection);
			const previousFiles = (await readdir(clipboardDirectory)).sort();
			const duplicate = await peer.request({ kind: 'duplicateClip', revision: imported.revision, trackId, clipId: imported.itemId, start: 128 });
			const witness = await peer.request({ kind: 'addTrack', revision: duplicate.revision, name: 'Redo witness' });
			const { revision } = await peer.request({ kind: 'undo', revision: witness.revision });
			const before = await peer.request(project);
			assert.ok(before.canUndo && before.canRedo);
			assert.equal(before.tracks[0]?.clipCount, 2);
			const clips = { kind: 'clips', revision, trackId, offset: 0 } as const;
			const beforeClips = await peer.request(clips);
			const cut = { kind: 'cutRange', trackId, mode: 'leaveGap', start: 128, end: 192 } as const;
			await chmod(clipboardDirectory, 0o500);
			try {
				await assert.rejects(peer.request({ ...cut, revision }), /Cannot create Tracktion clipboard storage/u);
				assert.deepEqual(await peer.request(project), before);
				assert.deepEqual(await peer.request(clips), beforeClips);
				assert.deepEqual(await readFile(selection), previousClipboard);
				assert.deepEqual((await readdir(clipboardDirectory)).sort(), previousFiles);
			} finally { await chmod(clipboardDirectory, 0o700); }

			const redone = await peer.request({ kind: 'redo', revision });
			assert.equal((await peer.request(project)).tracks[1]?.name, 'Redo witness');
			const pasted = await peer.request({ kind: 'pasteRange', revision: redone.revision, trackId, mode: 'overlap', start: 256 });
			const afterPaste = await peer.request({ ...clips, revision: pasted.revision });
			assert.deepEqual(afterPaste.clips.map(({ start, end }) => [start, end]), [[0, 64], [128, 192], [256, 320]]);
			const retried = await peer.request({ ...cut, revision: pasted.revision });
			assert.deepEqual((await peer.request({ ...clips, revision: retried.revision })).clips,
				[afterPaste.clips[0], afterPaste.clips[2]]);
			const undone = await peer.request({ kind: 'undo', revision: retried.revision });
			assert.deepEqual((await peer.request({ ...clips, revision: undone.revision })).clips, afterPaste.clips);
		} finally { await peer.close(); }
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('Tracktion Paste rejects incomplete media without changing the destination', { skip: process.platform !== 'linux' }, async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-paste-limit-'));
	try {
		const { launch, limitedPeer, trackId } = await prepareSizeLimitedClipboard(root, executable);
		const source = launchTracktionPeer({ ...launch, mode: 'open' });
		try {
			await source.request({ kind: 'copyRange', revision: 0, trackId, mode: 'leaveGap', start: shortStart, end: longStart + longFrames });
		} finally { await source.close(); }
		const selection = join(launch.clipboardDirectory, 'selection.xml');
		const previousClipboard = await readFile(selection);
		const projectDirectory = join(root, 'destination');
		const peer = launchTracktionPeer({ ...launch, executable: limitedPeer, projectDirectory, mode: 'create', sampleRate: 48_000 });
		try {
			const page = { kind: 'project', offset: 0 } as const;
			const before = await peer.request(page);
			const [destination] = before.tracks;
			assert.ok(destination);
			await assert.rejects(peer.request({ kind: 'pasteRange', revision: 0, trackId: destination.id, mode: 'insertTracks', start: 9 }),
				/Cannot adopt the clipboard media/u);
			assert.deepEqual(await peer.request(page), before);
			assert.deepEqual(await readdir(join(projectDirectory, 'media')), []);
			assert.deepEqual(await readFile(selection), previousClipboard);
		} finally { await peer.close(); }
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('Tracktion Paste keeps the live Edit and clipboard during a project media outage', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-paste-media-outage-'));
	const projectDirectory = join(root, 'project');
	const exchangeDirectory = join(root, 'exchange');
	const clipboardDirectory = join(root, 'clipboard');
	const launch = { executable, projectDirectory, exchangeDirectory, clipboardDirectory, stateDirectory: join(root, 'state') };
	const media = join(projectDirectory, 'media');
	const offline = join(root, 'offline-media');
	const selection = join(clipboardDirectory, 'selection.xml');
	const asset = 'f'.repeat(32);
	const wave = wavFixture();
	try {
		await mkdir(join(exchangeDirectory, 'input'), { recursive: true });
		await writeFile(join(exchangeDirectory, 'input', `${asset}.wav`), wave);
		const peer = launchTracktionPeer({ ...launch, mode: 'create', sampleRate: 48_000 });
		let trackId: string;
		let expectedClips: readonly TracktionClipView[];
		try {
			const page = { kind: 'project', offset: 0 } as const;
			const [track] = (await peer.request(page)).tracks;
			assert.ok(track);
			trackId = track.id;
			const imported = await peer.request({ kind: 'importFile', revision: 0, trackId, asset, name: 'Source', start: 0 });
			assert.ok(imported.itemId);
			await peer.request({ kind: 'save', revision: imported.revision });
			await peer.request({ kind: 'copyRange', revision: imported.revision, trackId, mode: 'leaveGap', start: 0, end: 64 });
			const previousClipboard = await readFile(selection);
			const previousFiles = (await readdir(clipboardDirectory)).sort();
			const duplicate = await peer.request({ kind: 'duplicateClip', revision: imported.revision, trackId, clipId: imported.itemId, start: 128 });
			const witness = await peer.request({ kind: 'addTrack', revision: duplicate.revision, name: 'Redo witness' });
			const { revision } = await peer.request({ kind: 'undo', revision: witness.revision });
			const before = await peer.request(page);
			assert.ok(before.canUndo && before.canRedo);
			assert.equal(before.tracks[0]?.clipCount, 2);
			const clipPage = { kind: 'clips', revision, trackId, offset: 0 } as const;
			const beforeClips = await peer.request(clipPage);
			const paste = { kind: 'pasteRange', mode: 'overlap', start: 512, trackId } as const;
			const [managed] = await readdir(media);
			assert.ok(managed);
			await rename(media, offline);
			try {
				await assert.rejects(peer.request({ ...paste, revision }), /project media directory is unavailable/u);
				assert.deepEqual(await peer.request(page), before);
				assert.deepEqual(await peer.request(clipPage), beforeClips);
				assert.deepEqual(await readFile(selection), previousClipboard);
				assert.deepEqual((await readdir(clipboardDirectory)).sort(), previousFiles);
			} finally { await rename(offline, media); }

			const redone = await peer.request({ kind: 'redo', revision });
			assert.equal((await peer.request(page)).tracks[1]?.name, 'Redo witness');
			const retried = await peer.request({ ...paste, revision: redone.revision });
			expectedClips = (await peer.request({ ...clipPage, revision: retried.revision })).clips;
			assert.deepEqual(expectedClips.slice(0, 2), beforeClips.clips);
			const pasted = expectedClips[2];
			assert.ok(pasted);
			assert.equal(expectedClips.length, 3);
			assert.deepEqual([pasted.name, pasted.start, pasted.end, pasted.sourceOffset], ['Source', 512, 576, 0]);
			assert.deepEqual(await readdir(media), [managed]);
			assert.deepEqual(await readFile(join(media, managed)), wave);
			await peer.request({ kind: 'save', revision: retried.revision });
		} finally { await peer.close(); }
		const reopened = launchTracktionPeer({ ...launch, mode: 'open' });
		try {
			assert.deepEqual((await reopened.request({ kind: 'clips', revision: 0, trackId, offset: 0 })).clips, expectedClips);
		} finally { await reopened.close(); }
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('Tracktion cut and insert paste preserve source material across projects', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-clipboard-'));
	const clipboardDirectory = join(root, 'clipboard');
	const exchangeDirectory = join(root, 'exchange');
	const sourceDirectory = join(root, 'source');
	const destinationDirectory = join(root, 'destination');
	const asset = 'e'.repeat(32);
	try {
		await mkdir(join(exchangeDirectory, 'input'), { recursive: true });
		await writeFile(join(exchangeDirectory, 'input', `${asset}.wav`), wavFixture(512));
		const launch = { executable, stateDirectory: join(root, 'state'), exchangeDirectory, clipboardDirectory };
		const source = launchTracktionPeer({ ...launch, projectDirectory: sourceDirectory, mode: 'create', sampleRate: 48_000 });
		try {
			const [track] = (await source.request({ kind: 'project', offset: 0 })).tracks;
			assert.ok(track);
			await source.request({ kind: 'importFile', revision: 0, trackId: track.id, asset, name: 'Source', start: 30 });
			await source.request({ kind: 'cutRange', revision: 1, trackId: track.id, mode: 'track', start: 100, end: 201 });
			const { clips } = await source.request({ kind: 'clips', revision: 2, trackId: track.id, offset: 0 });
			assert.deepEqual(clips.map(({ start, end, sourceOffset }) => [start, end, sourceOffset]), [[30, 100, 0], [100, 441, 171]]);
			await assert.rejects(source.request({ kind: 'copyRange', revision: 2, trackId: track.id, mode: 'leaveGap', start: 700, end: 800 }), /no audio/iu);
		} finally { await source.close(); }

		await rm(sourceDirectory, { recursive: true });
		const destination = launchTracktionPeer({ ...launch, projectDirectory: destinationDirectory, mode: 'create', sampleRate: 48_000 });
		try {
			const [track] = (await destination.request({ kind: 'project', offset: 0 })).tracks;
			assert.ok(track);
			await destination.request({ kind: 'importFile', revision: 0, trackId: track.id, asset, name: 'Destination', start: 0 });
			await destination.request({ kind: 'pasteRange', revision: 1, trackId: track.id, mode: 'insertTracks', start: 40 });
			const { clips } = await destination.request({ kind: 'clips', revision: 2, trackId: track.id, offset: 0 });
			assert.deepEqual(clips.map(({ name, start, end, sourceOffset }) => [name, start, end, sourceOffset]), [
				['Destination', 0, 40, 0], ['Source', 40, 141, 70], ['Destination', 141, 613, 40],
			]);
			await destination.request({ kind: 'undo', revision: 2 });
			assert.equal((await destination.request({ kind: 'project', offset: 0 })).tracks[0]?.clipCount, 1);
			await destination.request({ kind: 'pasteRange', revision: 3, trackId: track.id, mode: 'overlap', start: 600 });
			assert.equal((await readdir(join(destinationDirectory, 'media'))).length, 2, 'repeated paste keeps one copy of each media file');
			const { itemId: auxiliary } = await destination.request({ kind: 'addTrack', revision: 4, name: 'Auxiliary' });
			assert.ok(auxiliary);
			await destination.request({ kind: 'importFile', revision: 5, trackId: auxiliary, asset, name: 'Auxiliary', start: 100 });
			await destination.request({ kind: 'pasteRange', revision: 6, trackId: track.id, mode: 'insertAll', start: 500 });
			const shifted = await destination.request({ kind: 'clips', revision: 7, trackId: auxiliary, offset: 0 });
			assert.deepEqual(shifted.clips.map(({ start, end, sourceOffset }) => [start, end, sourceOffset]), [[100, 500, 0], [601, 713, 400]]);
		} finally { await destination.close(); }

		const lowerRate = launchTracktionPeer({ ...launch, projectDirectory: join(root, 'lower-rate'), mode: 'create', sampleRate: 44_100 });
		try {
			const [track] = (await lowerRate.request({ kind: 'project', offset: 0 })).tracks;
			assert.ok(track);
			await lowerRate.request({ kind: 'pasteRange', revision: 0, trackId: track.id, mode: 'overlap', start: 17 });
			const { clips } = await lowerRate.request({ kind: 'clips', revision: 1, trackId: track.id, offset: 0 });
			assert.deepEqual(clips.map(({ start, end, sourceOffset }) => [start, end, sourceOffset]), [[17, 110, 64]]);
		} finally { await lowerRate.close(); }
	} finally { await rm(root, { recursive: true, force: true }); }
});
