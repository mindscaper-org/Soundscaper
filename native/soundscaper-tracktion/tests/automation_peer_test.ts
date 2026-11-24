/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { launchTracktionPeer } from '../../../desktop/tracktion-peer.ts';
import { waveData, wavFixture } from './wave_fixture.ts';

const executable = process.env.SOUNDSCAPER_TRACKTION_TEST_PEER;
if (!executable) throw new Error('Run the Tracktion automation test through CTest.');

test('Tracktion gain and pan curves render, persist and ripple with track edits', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-automation-'));
	const exchangeDirectory = join(root, 'exchange');
	const projectDirectory = join(root, 'project');
	const asset = 'c'.repeat(32);
	const launch = { executable, projectDirectory, exchangeDirectory, stateDirectory: join(root, 'state'), clipboardDirectory: join(root, 'clipboard') };
	try {
		await mkdir(join(exchangeDirectory, 'input'), { recursive: true });
		await mkdir(join(exchangeDirectory, 'output'));
		await writeFile(join(exchangeDirectory, 'input', `${asset}.wav`), wavFixture(24_576));
		const peer = launchTracktionPeer({ ...launch, mode: 'create', sampleRate: 48_000 });
		let trackId: string;
		try {
			const [track] = (await peer.request({ kind: 'project', offset: 0 })).tracks;
			assert.ok(track);
			trackId = track.id;
			const base = { trackId, parameter: 'gainDb' } as const;
			const empty = await peer.request({ ...base, kind: 'trackAutomation', revision: 0, offset: 0 });
			assert.deepEqual(empty.points, []);
			await peer.request({ kind: 'importFile', trackId, revision: 0, asset, name: 'Tone', start: 0 });
			const gain = [
				{ frame: 0, value: 0, curve: 1 }, { frame: 8_192, value: -12, curve: 0 },
			];
			const pan = [
				{ frame: 0, value: 0, curve: 1 }, { frame: 16_384, value: 1, curve: 0 },
			];
			let revision = 1;
			for (const [parameter, points] of [['gainDb', gain], ['pan', pan]] as const) {
				for (const point of points) {
					const edit = await peer.request({ kind: 'setAutomationPoint', trackId, parameter, revision, index: null, ...point });
					revision = edit.revision;
				}
			}
			await assert.rejects(peer.request({ ...base, kind: 'setAutomationPoint', revision, index: null, ...gain[0]! }), /already exists/u);
			const removed = await peer.request({ ...base, kind: 'removeAutomationPoint', revision, index: 1 });
			assert.equal((await peer.request({ ...base, kind: 'trackAutomation', revision: removed.revision, offset: 0 })).points.length, 1);
			revision = (await peer.request({ kind: 'undo', revision: removed.revision })).revision;
			await peer.request({ kind: 'render', revision, asset, start: 0, end: 24_576 });
			const pcm = waveData(await readFile(join(exchangeDirectory, 'output', `${asset}.wav`)));
			assert.equal(pcm.readInt16LE(4 * 4_096), 4096);
			assert.ok(Math.abs(pcm.readInt16LE(4 * 12_288) - 1029) <= 2);
			assert.ok(Math.abs(pcm.readInt16LE(4 * 20_480)) <= 2);
			assert.ok(pcm.readInt16LE(4 * 20_480 + 2) < -500);
			const explicitMix = await peer.request({ kind: 'trackMix', trackId, revision });
			assert.equal(explicitMix.gainDb, 0);
			assert.equal(explicitMix.pan, 0);
			await peer.request({ kind: 'copyRange', trackId, revision, mode: 'track', start: 0, end: 1_024 });
			const inserted = await peer.request({ kind: 'pasteRange', trackId, revision, mode: 'insertTracks', start: 2_048 });
			const expanded = await peer.request({ ...base, kind: 'trackAutomation', revision: inserted.revision, offset: 0 });
			assert.equal(expanded.points.at(-1)?.frame, 9_216);
			revision = (await peer.request({ kind: 'undo', revision: inserted.revision })).revision;
			await peer.request({ kind: 'deleteRange', trackId, revision, mode: 'track', start: 2_048, end: 4_096 });
			const shifted = await peer.request({ ...base, kind: 'trackAutomation', revision: revision + 1, offset: 0 });
			assert.equal(shifted.points.at(-1)?.frame, 6_144);
			await peer.request({ kind: 'undo', revision: revision + 1 });
			await peer.request({ kind: 'save', revision: revision + 2 });
		} finally { await peer.close(); }
		const reopened = launchTracktionPeer({ ...launch, mode: 'open' });
		try {
			const lane = await reopened.request({ kind: 'trackAutomation', trackId, parameter: 'gainDb', revision: 0, offset: 0 });
			assert.equal(lane.points.at(-1)?.frame, 8_192);
			assert.ok(Math.abs((lane.points.at(-1)?.value ?? 0) + 12) < 0.001);
		} finally { await reopened.close(); }
	} finally { await rm(root, { recursive: true, force: true }); }
});
