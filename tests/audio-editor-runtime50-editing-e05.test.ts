/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTakeCompClipboardGroups } from '../src/common/editor/commands/take-comp-clipboard.ts';
import { visits, takeGroup } from './helpers/runtime50-editing-metrics.ts';

test('E05 take clipboard region normalization avoids quadratic identity searches', context => {
	const input = takeGroup(120);
	const before = structuredClone(input);
	let output: ReturnType<typeof normalizeTakeCompClipboardGroups> = [];
	const count = visits('find', () => { output = normalizeTakeCompClipboardGroups([input]); });
	assert.equal(output[0]!.compRegions.length, 120);
	assert.deepEqual(output[0]!.compRegions.map(region => region.key), input.compRegions.map(region => region.key));
	assert.ok(count <= 240, `region search work ${count}`);
	context.diagnostic(`E05 region find visits: ${count}`);
	assert.ok(Object.isFrozen(output[0]!.compRegions[0]));
	assert.deepEqual(input, before);
	assert.throws(() => normalizeTakeCompClipboardGroups([{ ...input, compRegions: [input.compRegions[0], input.compRegions[0]] }]), /duplicate|unique|identity/iu);
});
