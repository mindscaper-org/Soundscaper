/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { preserveDerivedFolderMixer } from '../src/common/editor/derived-track-folder-mixer.ts';
import { visits } from './helpers/runtime50-editing-metrics.ts';
import { bus, graph } from './helpers/runtime50-editing-routing.ts';

test('E08 derived folder mixer restores VCA memberships with indexed original VCAs', context => {
	const original = graph({ groups: [bus('folder')], vcas: Array.from({ length: 100 }, (_, index) => ({ id: `vca-${index}`, name: `VCA ${index}`, gain: 1, mute: false, members: [{ kind: 'mixer-node' as const, id: 'folder' }] })) });
	const staged = { ...original, vcas: original.vcas.map(vca => ({ ...vca, members: [] })) };
	const project = { trackFolders: [{ id: 'folder' }], tracks: [] };
	const result: { value?: ReturnType<typeof preserveDerivedFolderMixer> } = {};
	const count = visits('find', () => { result.value = preserveDerivedFolderMixer(project, project, original, staged); });
	// The graph normalizer retains two identity checks per VCA.
	assert.equal(count, 200, `original VCA search visits ${count}`);
	context.diagnostic(`E08 folder find visits: ${count}`);
	assert.deepEqual(result.value?.graph.vcas[99]!.members, [{ kind: 'mixer-node', id: 'folder' }]);
	assert.deepEqual(staged.vcas[99]!.members, []);
	const retained = preserveDerivedFolderMixer(project, project, original, original);
	assert.deepEqual(retained.graph.vcas[0]!.members, original.vcas[0]!.members);
	assert.equal(preserveDerivedFolderMixer({}, {}, original, staged).graph, staged);
});
