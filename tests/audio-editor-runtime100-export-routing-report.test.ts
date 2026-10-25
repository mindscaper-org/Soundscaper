/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createDawprojectExport } from '../src/common/editor/dawproject-export.ts';
import { visits } from './helpers/runtime50-editing-metrics.ts';

function routingProject(count: number) {
	return { sampleRate: 48_000, clips: [], sources: [],
		tracks: Array.from({ length: count }, (_, index) => ({ id: `t${index}`, type: 'audio', clipIds: [] })),
		mixer: { schemaVersion: 1, groups: [], sends: [],
			outputs: Object.freeze(Array.from({ length: count }, (_, index) => Object.freeze({ id: `o${index}`, name: `Output ${index}`, channelCount: 2, role: 'aux' }))),
			edges: Array.from({ length: count }, (_, index) => ({ id: `e${index}`, kind: 'assignment',
				source: { kind: 'track', id: `t${index}` }, destination: { kind: 'output', id: `o${count - 1}` }, channelMap: [0, 1] })) } };
}

test('R03 routing diagnostics index immutable output identities instead of rescanning per edge', context => {
	const results: ReturnType<typeof createDawprojectExport>[] = [];
	const count = visits('find', () => { results.push(createDawprojectExport({ project: routingProject(200) })); });
	const result = results[0]!;
	const digest = createHash('sha256').update(result.projectXml).update(JSON.stringify(result.report)).digest('hex');
	context.diagnostic(`R03 find visits: ${count}; exact XML/report digest: ${digest}`);
	assert.equal(digest, '087d88de5f490c8c11b51d5497367aa9ff1555a82833d04731d127c05eb14f5b');
	assert.ok(count < 2000, `routing report visited ${count} output identities`);
});

test('R03 duplicate output identities retain first endpoint and any matching main-output authority', () => {
	const base = routingProject(2);
	const outputs = Object.freeze([Object.freeze({ id: 'shared', name: 'First endpoint', channelCount: 2, role: 'aux' }),
		Object.freeze({ id: 'shared', name: 'Later main output', channelCount: 4, role: 'main' })]);
	const project = { ...base, mixer: { ...base.mixer, outputs,
		edges: base.mixer.edges.map(edge => ({ ...edge, destination: { kind: 'output', id: 'shared' } })) } };
	assert.deepEqual(createDawprojectExport({ project }), createDawprojectExport({ project: structuredClone(project) }));
});

test('R03 frozen output-role accessors keep the same live lookup behavior as mutable inventories', () => {
	const run = (immutable: boolean) => {
		let roleReads = 0;
		const base = routingProject(3);
		const outputs = base.mixer.outputs.map(output => Object.freeze({ ...output, get role() { roleReads++; return 'aux'; } }));
		const result = createDawprojectExport({ project: { ...base, mixer: { ...base.mixer, outputs: immutable ? Object.freeze(outputs) : outputs } } });
		return { result, roleReads };
	};
	assert.deepEqual(run(true), run(false));
});
