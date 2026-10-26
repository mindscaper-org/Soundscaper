/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { copyDerivedTrackRouteAutomation } from '../src/common/editor/derived-track-route-automation.ts';
import { normalizeAutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import { routeLane } from './helpers/runtime50-editing-routing.ts';

test('E09 copied route automation visits only copies of each lane edge', context => {
	let copyReads = 0, identity = 0;
	const copies = Array.from({ length: 100 }, (_, index) => ({ get sourceEdgeId() { copyReads += 1; return `edge-${index}`; }, targetEdgeId: `copy-${index}` }));
	const project = { automationLanes: copies.map((_, index) => routeLane(index)) };
	const before = structuredClone(project);
	const commands = copyDerivedTrackRouteAutomation(project, {}, copies, prefix => `${prefix}-${identity++}`);
	assert.equal(commands.length, 100);
	assert.ok(copyReads <= 400, `copy edge reads ${copyReads}`);
	context.diagnostic(`E09 automation copy reads: ${copyReads}`);
	assert.deepEqual(project, before);
	const first = commands[0]!;
	assert.equal(first.type, 'automation-lane/set');
	if (first.type !== 'automation-lane/set') throw new Error('Expected automation');
	assert.deepEqual(normalizeAutomationLaneV21(first.lane).address, { kind: 'edge', edgeId: 'copy-0', parameterId: 'level' });
	assert.equal(copyDerivedTrackRouteAutomation(project, {}, [copies[0]!, copies[0]!], prefix => `${prefix}-${identity++}`).length, 1);
	assert.equal(copyDerivedTrackRouteAutomation(project, { automationLanes: [first.lane] }, [copies[0]!], () => 'unused').length, 0);
});
