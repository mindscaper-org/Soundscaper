/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { launchTracktionPeer } from '../../../desktop/tracktion-peer.ts';

const executable = process.env.SOUNDSCAPER_TRACKTION_TEST_PEER;
if (!executable) throw new Error('Run the peer test through CTest.');

const asset = '0123456789abcdef'.repeat(2);

function wavFixture(): Buffer {
	const samples = 64;
	const rate = 48_000;
	const pcm = Buffer.alloc(44 + samples * 4);
	pcm.write('RIFF');
	pcm.writeUInt32LE(pcm.byteLength - 8, 4);
	pcm.write('WAVEfmt ', 8);
	pcm.writeUInt32LE(16, 16);
	pcm.writeUInt16LE(1, 20);
	pcm.writeUInt16LE(2, 22);
	pcm.writeUInt32LE(rate, 24);
	pcm.writeUInt32LE(rate * 4, 28);
	pcm.writeUInt16LE(4, 32);
	pcm.writeUInt16LE(16, 34);
	pcm.write('data', 36);
	pcm.writeUInt32LE(samples * 4, 40);
	for (let frame = 0; frame < samples; frame += 1) {
		pcm.writeInt16LE(4096, 44 + frame * 4);
		pcm.writeInt16LE(-2048, 46 + frame * 4);
	}
	return pcm;
}

test('the framed Tracktion peer owns edits and publishes output through opaque exchange slots', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-peer-'));
	const projectDirectory = join(root, 'project');
	const stateDirectory = join(root, 'settings');
	const exchangeDirectory = join(root, 'exchange');
	const launch = { executable, projectDirectory, stateDirectory, exchangeDirectory };
	try {
		await mkdir(join(exchangeDirectory, 'input'), { recursive: true });
		await mkdir(join(exchangeDirectory, 'output'));
		await writeFile(join(exchangeDirectory, 'input', `${asset}.wav`), wavFixture());

		const peer = launchTracktionPeer({ ...launch, mode: 'create', sampleRate: 48_000 });
		try {
			const initial = await peer.request({ kind: 'project', offset: 0 });
			assert.equal(initial.revision, 0);
			assert.equal(initial.sampleRate, 48_000);
			assert.equal(initial.tracks.length, 1);
			const initialTrack = initial.tracks[0];
			assert.ok(initialTrack);
			assert.equal(initialTrack.clipCount, 0);
			const { revision, itemId } = await peer.request({
				kind: 'import', revision: 0, trackId: initialTrack.id,
				asset, name: 'Reference', start: 31, sourceOffset: 5, frames: 52,
			});
			assert.equal(revision, 1);
			assert.ok(itemId);

			await assert.rejects(peer.request({ kind: 'split', revision: 0, clipId: itemId, frame: 54 }), /revision/u);
			const page = await peer.request({ kind: 'clips', revision, trackId: initialTrack.id, offset: 0 });
			assert.deepEqual(page.clips, [{ id: itemId, name: 'Reference', start: 31, end: 83, sourceOffset: 5 }]);
			await assert.rejects(peer.request({
				kind: 'render', revision, start: 0, end: 87, asset: '../escape',
			}), /handle/u);
			const extraField = { kind: 'project', offset: 0, unexpected: true } as const;
			await assert.rejects(peer.request(extraField), /shape/u);

			const split = await peer.request({ kind: 'split', revision, clipId: itemId, frame: 54 });
			assert.equal(split.revision, 2);
			assert.ok(split.itemId);
			assert.equal((await peer.request({ kind: 'undo', revision: 2 })).revision, 3);
			assert.equal((await peer.request({ kind: 'redo', revision: 3 })).revision, 4);
			await peer.request({ kind: 'save', revision: 4 });
			await peer.request({ kind: 'render', revision: 4, start: 0, end: 87, asset });

			const bytes = await readFile(join(exchangeDirectory, 'output', `${asset}.wav`));
			assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
			assert.equal(bytes.subarray(8, 12).toString(), 'WAVE');
			assert.ok(bytes.includes(Buffer.from([0, 16, 0, 248])), 'output contains independent expected PCM');
		} finally {
			await peer.close();
		}

		const reopened = launchTracktionPeer({ ...launch, mode: 'open' });
		try {
			const summary = await reopened.request({ kind: 'project', offset: 0 });
			assert.equal(summary.revision, 0);
			assert.equal(summary.tracks[0]?.clipCount, 2);
			assert.equal(summary.canUndo, false);

			for (let revision = 0; revision < 33; revision += 1) {
				await reopened.request({ kind: 'addTrack', revision, name: `Track ${String(revision)}` });
			}
			const firstPage = await reopened.request({ kind: 'project', offset: 0 });
			assert.equal(firstPage.tracks.length, 32);
			assert.equal(firstPage.nextOffset, 32);
			const lastPage = await reopened.request({ kind: 'project', offset: 32 });
			assert.equal(lastPage.revision, firstPage.revision);
			assert.equal(lastPage.tracks.length, 2);
			assert.equal(lastPage.nextOffset, null);
		} finally {
			await reopened.close();
		}

		const cancelled = launchTracktionPeer({ ...launch, mode: 'open' });
		const pending = cancelled.request({ kind: 'project', offset: 0 });
		const rejection = assert.rejects(pending);
		await cancelled.close();
		await rejection;
		await assert.rejects(cancelled.request({ kind: 'project', offset: 0 }), /closed/u);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
