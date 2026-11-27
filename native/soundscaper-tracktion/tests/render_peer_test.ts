/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { launchTracktionPeer } from '../../../desktop/tracktion-peer.ts';
import { readTracktionProjectRequest } from '../../../desktop/tracktion-project-request.ts';
import { waveData, wavFixture } from './wave_fixture.ts';

const executable = process.env.SOUNDSCAPER_TRACKTION_TEST_PEER;
if (!executable) throw new Error('Run the Tracktion render test through CTest.');

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
