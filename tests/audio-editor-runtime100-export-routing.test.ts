/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createDawprojectExport } from '../src/common/editor/dawproject-export.ts';
import { visits } from './helpers/runtime50-editing-metrics.ts';

function routingProject(count: number) {
	const tracks = Array.from({ length: count }, (_, index) => ({ id: `track-${index}`, type: 'audio', clipIds: [] }));
	return { sampleRate: 48_000, tracks, sources: [], clips: [],
		mixer: { groups: Array.from({ length: count }, (_, index) => ({ id: `group-${index}`, name: `Bus ${index}` })),
			sends: Array.from({ length: count }, (_, index) => ({ id: `send-${index}`, name: `Send ${index}` })),
			routes: Object.fromEntries(tracks.map(track => [track.id, { groupId: `group-${count - 1}`, sends: { [`send-${count - 1}`]: .25 } }] as const)) } };
}

test('R01 DAWproject exports share normalized bus and send identities across channel routes', context => {
	const captured: ReturnType<typeof createDawprojectExport>[] = [];
	const count = visits('find', () => { captured.push(createDawprojectExport({ project: routingProject(160) })); });
	const result = captured[0]!;
	const digest = createHash('sha256').update(result.projectXml).update(JSON.stringify(result.report)).digest('hex');
	context.diagnostic(`R01 Array.find visits: ${count}; exact XML/report digest: ${digest}`);
	assert.equal(digest, '49452b646f1b740e64264b55d9cc5acf5ca40ccf26961287203e11d127eca10d');
	assert.ok(count < 500, `normalized routing repeated ${count} find visits`);
	assert.match(result.projectXml, /name="Bus 159"/u);
	assert.match(result.projectXml, /name="Send 159"/u);
});

test('R01 each export reflects replacement routing and string-key collisions safely', () => {
	const project = routingProject(2);
	project.mixer.groups[1]!.id = '__proto__';
	assert.equal(Reflect.set(project.mixer.routes['track-0']!, 'groupId', '__proto__'), true);
	const first = createDawprojectExport({ project });
	project.mixer.groups[1]!.name = 'Replacement bus';
	const second = createDawprojectExport({ project });
	assert.match(first.projectXml, /name="Bus 1"/u);
	assert.doesNotMatch(first.projectXml, /Replacement bus/u);
	assert.match(second.projectXml, /name="Replacement bus"/u);
});
