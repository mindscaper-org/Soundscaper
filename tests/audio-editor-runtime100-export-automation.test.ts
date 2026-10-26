/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createDawprojectExport } from '../src/common/editor/dawproject-export.ts';
import { createDawprojectStripLaneReader } from '../src/common/editor/dawproject-export-automation.ts';
import { visits } from './helpers/runtime50-editing-metrics.ts';

function automationProject(count: number) {
	const tracks = Array.from({ length: count }, (_, index) => ({ id: `t${index}`, type: 'audio', clipIds: [] }));
	const automationLanes = Object.freeze(tracks.map(track => Object.freeze({
		id: `lane-${track.id}`, address: Object.freeze({ kind: 'strip', strip: Object.freeze({ kind: 'track', id: track.id }), parameterId: 'pan' }),
		timebase: 'absolute-samples', points: [{ id: 'p', position: 0, value: .25 }], segments: [],
	})));
	return { sampleRate: 48_000, tracks, clips: [], sources: [], automationLanes };
}

test('R02 DAWproject automation partitions immutable lane addresses once per export', context => {
	const captured: ReturnType<typeof createDawprojectExport>[] = [];
	const count = visits('filter', () => { captured.push(createDawprojectExport({ project: automationProject(200) })); });
	const result = captured[0]!;
	const digest = createHash('sha256').update(result.projectXml).update(JSON.stringify(result.report)).digest('hex');
	context.diagnostic(`R02 filter visits: ${count}; exact XML/report digest: ${digest}`);
	assert.equal(digest, '1833d65d5895db4f122d43e84b9a724a21d49fcefbc53378263748fdf6190167');
	assert.ok(count < 10_000, `automation scanned ${count} lane/filter entries`);
});

test('R02 frozen and mutable automation retain duplicate authority and current lane ownership', () => {
	const original = automationProject(2);
	const master = Object.freeze({ ...original.automationLanes[0]!, id: 'master-lane',
		address: Object.freeze({ kind: 'strip', strip: Object.freeze({ kind: 'master' }), parameterId: 'gain' }) });
	const lanes = Object.freeze([...original.automationLanes, master, Object.freeze({ ...original.automationLanes[0]!, id: 'last-pan' })]);
	const project = { ...original, automationLanes: lanes };
	assert.deepEqual(createDawprojectExport({ project }), createDawprojectExport({ project: structuredClone(project) }));
	const owner: { automationLanes: readonly unknown[] } = { automationLanes: lanes };
	const read = createDawprojectStripLaneReader(owner);
	assert.equal(read('track:t0').get('pan')?.id, 'last-pan');
	assert.equal(read('master').get('gain')?.id, 'master-lane');
	owner.automationLanes = Object.freeze([Object.freeze({ ...original.automationLanes[0]!, id: 'replacement' })]);
	assert.equal(read('track:t0').get('pan')?.id, 'replacement');
	const mutable = structuredClone(original.automationLanes[0]!);
	owner.automationLanes = [mutable];
	assert.equal(read('track:t0').get('pan')?.id, mutable.id);
	assert.equal(Reflect.set(mutable.address.strip, 'id', 't1'), true);
	assert.equal(read('track:t0').size, 0);
	assert.equal(read('track:t1').get('pan')?.id, mutable.id);
});

test('R02 frozen accessor addresses preserve the original live reads and deferred errors', () => {
	const lane = automationProject(1).automationLanes[0]!;
	let reads = 0;
	const accessor = Object.freeze({ id: 'accessor', get address() { reads++; return lane.address; } });
	const read = createDawprojectStripLaneReader({ automationLanes: Object.freeze([accessor]) });
	assert.equal(reads, 0);
	assert.equal(read('track:t0').get('pan'), accessor);
	assert.equal(reads, 2);
	const throwing = createDawprojectStripLaneReader({ automationLanes: Object.freeze([Object.freeze({
		get address(): never { throw new Error('late lane read'); },
	})]) });
	assert.throws(() => throwing('track:t0'), /late lane read/u);
});
