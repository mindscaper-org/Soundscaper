/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createDocumentTrackFolderSnapshot } from '../src/common/editor/controller/document/document-track-folder-snapshot.ts';
import { planTrackListRows } from '../src/common/editor/ui/timeline/track-folder-ui-model.ts';
import type { ControllerRackEffect } from '../src/common/editor/controller/effects/internal/rack-effect-service-types.ts';
import { createSoundscaperProject, type SoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { readPcm } from './helpers/project-store-pcm-fixture.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';

type Operation = 'split' | 'duplicate';
type Mode = 'clip' | 'range' | 'partial range';

for (const operation of ['split', 'duplicate'] as const) for (const mode of ['clip', 'range', 'partial range'] as const) {
	for (const foldered of operation === 'split' ? [false, true] : [false]) test(`${operation} ${mode} keeps processors, routes and ${foldered ? 'folder' : 'root'} ownership through history and Scape reopen`, async context => {
		const { controller, store } = await controllerSession(context, {
			engineFactory: () => { throw new Error('Structural edits must preserve stored PCM without a synthetic render.'); },
		});
		const source = createAudioSource({ id: 'source', sampleRate: 48_000, channelCount: 2, frameCount: 38_400 });
		const pcm = [new Float32Array(38_400).fill(.25), new Float32Array(38_400).fill(-.125)];
		const writer = await store.beginSourceWrite(source.storageKey, source); await writer.write(pcm); await writer.commit();
		const original = createSoundscaperProject({ id: `derived-${operation}-${mode}-${String(foldered)}`, sources: [source],
			tracks: [createAudioTrack({ id: 'empty', name: 'Track 1' }),
				createAudioTrack({ id: 'alpha', name: 'Alpha', clipIds: ['voice'] }), createAudioTrack({ id: 'bravo', name: 'Bravo', clipIds: ['companion'] })],
			clips: ['voice', 'companion'].map(id => createAudioClip({ id, title: id, sourceId: source.id, durationFrames: 38_400, sourceDurationFrames: 38_400 })) });
		await store.saveProject(original); await controller.actions.project.open(original);
		await controller.actions.effects.add({ scope: 'track', trackId: 'alpha', type: 'lowpass', options: { params: { frequency: 1200, q: 1.5 } } });
		await controller.actions.effects.add({ scope: 'track', trackId: 'alpha', type: 'delay', options: { enabled: false,
			params: { time: .25, feedback: .4, mix: .3 } } });
		const group = controller.actions.mixer.addBus('group'); const send = controller.actions.mixer.addBus('send');
		assert.ok(typeof group === 'string' && typeof send === 'string');
		await controller.actions.mixer.setRoute('alpha', { groupId: group, sends: { [send]: .5 } });
		if (foldered) await controller.actions.trackFolders.wrapSelection(['alpha', 'bravo']);
		controller.actions.trackFolders.select(null);
		await controller.actions.timeline.selectClip('voice');
		if (mode === 'clip') await controller.actions.transport.seek(12_000);
		else await controller.actions.timeline.setSelection(mode === 'range' ? 0 : 9600, mode === 'range' ? 38_400 : 28_800, { trackIds: ['alpha'] });
		const before = structuredClone(controller.project); assert.ok(validateSoundscaperProject(before));
		const undoCount = controller.getSnapshot().history.undoEntries.length;
		if (operation === 'split') await controller.actions.edit.splitIntoNewTrack();
		else await controller.actions.edit.duplicate();
		const after = structuredClone(controller.project); assert.ok(validateSoundscaperProject(after));
		assert.equal(controller.getSnapshot().history.undoEntries.length, undoCount + 1);
		const derivedId = controller.getSnapshot().selectedTrackId; assert.ok(derivedId && derivedId !== 'alpha');
		assertDerived(after, operation, mode, foldered, group, send, derivedId);
		await controller.actions.edit.undo();
		assert.deepEqual(controller.project?.tracks, before.tracks); assert.deepEqual(controller.project?.clips, before.clips);
		assert.deepEqual(controller.project?.mixer, before.mixer);
		await controller.actions.edit.redo();
		assert.deepEqual(controller.project?.tracks, after.tracks); assert.deepEqual(controller.project?.clips, after.clips);
		assert.deepEqual(controller.project?.mixer, after.mixer);
		const archive = createSoundscaperScapeNativeRuntime();
		const exported = await archive.exportScapeProject(controller.project, store); assert.ok(exported.blob);
		const recipient = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
		context.after(async () => { await recipient.close(); });
		const reopened = await archive.importScapeProject(exported.blob, recipient);
		assert.equal(reopened.readOnly, false); assert.ok(validateSoundscaperProject(reopened.project));
		assertDerived(reopened.project, operation, mode, foldered, group, send, derivedId);
		assert.equal(reopened.project.sources.length, 1);
		const restoredSource = reopened.project.sources[0]; assert.ok(restoredSource?.kind === 'audio');
		assert.equal(restoredSource.sampleRate, 48_000); assert.equal(restoredSource.channelCount, 2); assert.equal(restoredSource.frameCount, 38_400);
		assertPcmChannelsEqual((await readPcm(recipient, restoredSource.storageKey)).map(channel => Float32Array.from(channel)), pcm);
	});
}

function assertDerived(project: SoundscaperProject, operation: Operation, mode: Mode, foldered: boolean, group: string, send: string, derivedId: string): void {
	const names = operation === 'split' ? ['Track 1', 'Alpha', 'Alpha 2', 'Bravo'] : ['Track 1', 'Alpha', 'Bravo', 'Alpha'];
	assert.deepEqual(project.tracks.map(track => track.name), names);
	const source = project.tracks.find(track => track.id === 'alpha'); const derived = project.tracks.find(track => track.id === derivedId);
	assert.ok(source?.type === 'audio' && derived?.type === 'audio');
	const originalEffects = source.effects as readonly ControllerRackEffect[], effects = derived.effects as readonly ControllerRackEffect[];
	assert.equal(effects.length, 2); assert.deepEqual(effects.map(effect => [effect.type, effect.enabled]), [['lowpass', true], ['delay', false]]);
	assert.equal(effects[0]?.params.frequency, 1200); assert.equal(effects[0]?.params.q, 1.5);
	assert.deepEqual([effects[1]?.params.time, effects[1]?.params.feedback, effects[1]?.params.mix], [.25, .4, .3]);
	assert.ok(effects.every(effect => originalEffects.every(original => original.id !== effect.id)));
	const edges = project.mixer.edges.filter(edge => edge.source.kind === 'track' && edge.source.id === derived.id);
	assert.equal(edges.length, foldered ? 3 : 2);
	const assignment = edges.find(edge => edge.kind === 'assignment' && edge.destination.kind === 'mixer-node' && edge.destination.id === group);
	const delivery = edges.find(edge => edge.kind === 'send');
	assert.ok(assignment?.destination.kind === 'mixer-node'); assert.equal(assignment.destination.id, group); assert.equal(assignment.level, 1);
	assert.ok(delivery?.destination.kind === 'mixer-node'); assert.equal(delivery.destination.id, send); assert.equal(delivery.level, .5);
	assert.equal(new Set(project.mixer.edges.map(edge => edge.id)).size, project.mixer.edges.length);
	const rows = planTrackListRows(createDocumentTrackFolderSnapshot(project), project.tracks).entries;
	const sourceRow = rows.find(row => row.kind === 'track' && row.trackId === source.id);
	const derivedRow = rows.find(row => row.kind === 'track' && row.trackId === derived.id);
	assert.ok(sourceRow?.kind === 'track' && derivedRow?.kind === 'track');
	assert.equal(derivedRow.parentFolderId, sourceRow.parentFolderId);
	assert.equal(derivedRow.parentFolderId !== null, foldered);
	assert.deepEqual(rows.flatMap(row => row.kind === 'track' ? [project.tracks.find(track => track.id === row.trackId)?.name] : []),
		names);
	if (foldered) {
		const folderAssignment = edges.find(edge => edge.kind === 'assignment' && edge.destination.kind === 'mixer-node'
			&& edge.destination.id === derivedRow.parentFolderId);
		assert.ok(folderAssignment); assert.equal(folderAssignment.level, 1);
	}
	const moved = project.clips.filter(clip => derived.clipIds.includes(clip.id));
	assert.equal(moved.length, 1); const clip = moved[0]; assert.ok(clip?.kind === 'audio');
	const start = mode === 'partial range' ? 9600 : operation === 'split' && mode === 'clip' ? 12_000 : 0;
	const duration = mode === 'partial range' ? 19_200 : operation === 'split' && mode === 'clip' ? 26_400 : 38_400;
	assert.deepEqual([clip.timelineStartFrame, clip.durationFrames, clip.sourceStartFrame, clip.sourceDurationFrames], [start, duration, start, duration]);
	const retained = project.clips.filter(clip => source.clipIds.includes(clip.id));
	const windows = retained.map(clip => [clip.timelineStartFrame, clip.durationFrames, clip.sourceStartFrame]).sort((left, right) => Number(left[0]) - Number(right[0]));
	assert.deepEqual(windows, operation === 'duplicate' ? [[0, 38_400, 0]] : mode === 'range' ? []
		: mode === 'clip' ? [[0, 12_000, 0]] : [[0, 9600, 0], [28_800, 9600, 28_800]]);
}
