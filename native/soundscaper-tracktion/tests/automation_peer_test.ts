/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { inspectTracktionReply } from '../../../desktop/tracktion-peer-contract.ts';
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

test('Tracktion returns the ordered automation point index across pages and unchanged updates', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-automation-order-'));
	const exchangeDirectory = join(root, 'exchange');
	try {
		await mkdir(exchangeDirectory);
		const peer = launchTracktionPeer({ executable, exchangeDirectory, projectDirectory: join(root, 'project'),
			stateDirectory: join(root, 'state'), mode: 'create', sampleRate: 48_000 });
		try {
			const [track] = (await peer.request({ kind: 'project', offset: 0 })).tracks;
			assert.ok(track);
			const lane = { trackId: track.id, parameter: 'pan' } as const;
			const point = { ...lane, kind: 'setAutomationPoint', value: -0.5, curve: 0 } as const;
			const history = { canUndo: true, canRedo: false };
			for (let index = 0; index <= 32; index += 1) {
				const added = await peer.request({ ...point, revision: index, index: null, frame: index * 128 });
				assert.deepEqual(added, { revision: index + 1, itemId: null, pointIndex: index, history });
			}
			const moved = await peer.request({ ...point, revision: 33, index: 0, frame: 4097 });
			assert.deepEqual(moved, { revision: 34, itemId: null, pointIndex: 32, history });
			const last = await peer.request({ ...lane, kind: 'trackAutomation', revision: moved.revision, offset: 32 });
			assert.deepEqual(last.points, [{ frame: 4097, value: -0.5, curve: 0 }]);
			const same = await peer.request({ ...point, revision: 34, index: 32, frame: 4097 });
			assert.deepEqual(same, moved);
			const updated = await peer.request({ ...point, revision: 34, index: 32, frame: 4097, value: -0.25 });
			assert.deepEqual(updated, { revision: 35, itemId: null, pointIndex: 32, history });
			const returned = await peer.request({ ...point, revision: 35, index: 32, frame: 0 });
			assert.deepEqual(returned, { revision: 36, itemId: null, pointIndex: 0, history });
			const first = await peer.request({ ...lane, kind: 'trackAutomation', revision: returned.revision, offset: 0 });
			assert.deepEqual(first.points[0], { frame: 0, value: -0.5, curve: 0 });
		} finally { await peer.close(); }
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('the peer validates the point index and the revision in automation replies', () => {
	const point = { kind: 'setAutomationPoint', parameter: 'pan', trackId: '1', revision: 3,
		index: 0, frame: 32, value: 0, curve: 0 } as const;
	const changed = { revision: 4, itemId: null, pointIndex: 1 } as const;
	const read = (value: unknown) => inspectTracktionReply({ ok: true, value }, point);
	assert.deepEqual(read(changed), changed);
	const withHistory = { ...changed, history: { canUndo: true, canRedo: false } };
	assert.deepEqual(read(withHistory), withHistory);
	assert.throws(() => read({ ...changed, history: { canUndo: true, canRedo: 0 } }), /invalid.*history/iu);
	assert.throws(() => read({ ...changed, pointIndex: -1 }), /integer/u);
	assert.throws(() => read({ ...changed, revision: 3 }), /unchanged automation point/u);
	assert.throws(() => read({ ...changed, revision: 5 }), /invalid revision/u);
	const clear = { kind: 'clearAutomation', parameter: 'pan', trackId: '1', revision: 3 } as const;
	assert.deepEqual(inspectTracktionReply({ ok: true, value: { revision: 4, itemId: null } }, clear), { revision: 4, itemId: null });
	assert.throws(() => inspectTracktionReply({ ok: true, value: changed }, clear), /unsupported field/u);
});
