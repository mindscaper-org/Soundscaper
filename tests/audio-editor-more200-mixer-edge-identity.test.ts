/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject, loadSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand as apply } from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { mixerTrackSurfaceRouteV21 } from '../src/common/editor/mixer-graph-surface-v21.ts';

for (const kind of ['group', 'send'] as const) test(`native compact ${kind} edges distinguish colon-bearing endpoint pairs after Save and reopen`, async () => {
	let project = createSoundscaperProject({ id: `edge-collision-${kind}`, tracks: [
		{ type: 'audio', id: 'a:mixer-node:b', name: 'First voice' },
		{ type: 'audio', id: 'a', name: 'Second voice' },
	] });
	for (const id of ['c', 'b:mixer-node:c']) project = apply(project, {
		type: 'mixer/bus-add', busType: kind, bus: { id, name: id },
	});
	const route = (trackId: string, busId: string) => ({ type: 'mixer/route-update' as const, trackId,
		changes: kind === 'group' ? { groupId: busId } : { sends: { [busId]: 0.5 } } });
	project = apply(project, route('a:mixer-node:b', 'c'));
	project = createSoundscaperProject({ ...project, mixer: { ...project.mixer, edges: project.mixer.edges.map(edge =>
		edge.source.kind === 'track' && edge.source.id === 'a:mixer-node:b' && edge.kind === (kind === 'group' ? 'assignment' : 'send')
			? { ...edge, id: `${kind === 'group' ? 'assignment' : 'send'}:track:a:mixer-node:b:mixer-node:c` } : edge) } });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `edge-${kind}` });
	try {
		const native = createSoundscaperScapeNativeRuntime();
		const archive = await native.exportScapeProject(project, store);
		assert.ok(archive.blob);
		const loaded = loadSoundscaperProject((await native.importScapeProject(archive.blob, store)).project);
		assert.equal(loaded.readOnly, false);
		const edited = apply(loaded.project, route('a', 'b:mixer-node:c'));
		assert.equal(new Set(edited.mixer.edges.map(edge => edge.id)).size, edited.mixer.edges.length);
		for (const [trackId, busId] of [['a:mixer-node:b', 'c'], ['a', 'b:mixer-node:c']] as const) {
			const value = mixerTrackSurfaceRouteV21(edited.mixer, trackId, { sourceChannels: 2, masterChannels: 2 });
			if (kind === 'group') { assert.equal(value.groupEditable, true); assert.equal(value.groupId, busId); }
			else { assert.ok(value.editableSendIds.includes(busId)); assert.equal(value.sends[busId], 0.5); }
		}
		const saved = await native.exportScapeProject(edited, store);
		assert.ok(saved.blob);
		const reopened = loadSoundscaperProject((await native.importScapeProject(saved.blob, store)).project);
		assert.equal(reopened.readOnly, false);
		assert.deepEqual(reopened.project.mixer, edited.mixer);
		assert.doesNotThrow(() => apply(reopened.project, route('a', 'b:mixer-node:c')));
		assert.doesNotThrow(() => apply(reopened.project, route('a:mixer-node:b', 'c')));
	} finally { await store.close(); }
});

test('compact mixer keeps existing ordinary edge IDs and refuses advanced assignments', () => {
	let project = createSoundscaperProject({ id: 'ordinary-edge', tracks: [{ type: 'audio', id: 'voice' }] });
	project = apply(project, { type: 'mixer/bus-add', busType: 'group', bus: { id: 'room' } });
	project = apply(project, { type: 'mixer/route-update', trackId: 'voice', changes: { groupId: 'room' } });
	const edge = project.mixer.edges.find(edge => edge.source.kind === 'track')!;
	assert.equal(edge.id, 'assignment:track:voice:mixer-node:room');
	project = createSoundscaperProject({ ...project, mixer: { ...project.mixer, edges: project.mixer.edges.map(value => value === edge ? { ...value, id: 'advanced-assignment' } : value) } });
	assert.throws(() => apply(project, { type: 'mixer/route-update', trackId: 'voice', changes: { groupId: null } }), /advanced assignment/iu);
});
