import assert from 'node:assert/strict';
import test from 'node:test';

import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createEditorDocumentSnapshot, type EditorDocumentSnapshotRuntime, type SnapshotProject } from '../src/common/editor/controller/document/document-snapshot.ts';
import { createDocumentMasteringSequenceSnapshot } from '../src/common/editor/controller/document/document-mastering-sequence-snapshot.ts';
import { createDocumentTimelineAnnotationSnapshot } from '../src/common/editor/controller/document/internal/snapshots/document-timeline-annotation-snapshot.ts';
import { validateMasteringSequenceV23 } from '../src/common/editor/mastering-sequence.ts';
import { stateFixture } from './helpers/audio-editor-snapshot-state.ts';
import { DEFAULT_SOUND_ACTIVATION_PREFERENCES } from '../src/common/editor/sound-activation-preferences.ts';

const COUNT = 100, ORDERS = 20;
const PROJECT = createSoundscaperProject({ id: 'document-view-work', primarySequenceId: 'main',
	tracks: Array.from({ length: COUNT }, (_, index) => ({ id: `track-${index}`, clipIds: [] })), trackFolders: [{ id: 'folder', name: 'All tracks' }],
	sequences: [{ id: 'main', trackNodes: [{ id: 'folder', kind: 'folder', parentFolderId: null },
		...Array.from({ length: COUNT }, (_, index) => ({ id: `track-${index}`, kind: 'track', parentFolderId: 'folder' }))] }],
	timelineAnnotations: Array.from({ length: COUNT }, (_, index) => ({ id: `region-${index}`, sequenceId: 'main', name: `Region ${index}`,
		kind: 'region', anchor: 'sample', startFrame: index * 128, endFrame: index * 128 + 64, color: 'auto', batchId: null, opaqueExtensions: {} })),
	masteringSequences: Array.from({ length: ORDERS }, (_, index) => ({ id: `order-${index}`, name: `Order ${index}`, sequenceId: 'main',
		entries: [{ id: `entry-${index}`, annotationId: `region-${index}` }] })) });

function runtime(getProject: () => SnapshotProject): EditorDocumentSnapshotRuntime<SnapshotProject> {
	return { state: stateFixture(), product: null, productId: 'soundscaper', capabilities: {}, locale: 'en',
		getCurrentProject: getProject, projectForPlayback: project => project, getProjectTabs: () => [], getCurrentTabMetadata: () => ({}),
		recordingPreviewSnapshot: () => null, getAudioDevicesSnapshot: () => ({}),
		getSoundActivationSnapshot: () => ({ preferences: DEFAULT_SOUND_ACTIVATION_PREFERENCES, preferenceMutationBlocked: false,
			preferenceMutationBlockReason: null, sources: [] }), sampleEditingAvailable: () => false, canUndo: () => false, canRedo: () => false,
		historyEntrySummary: entry => entry, getStorageStatus: () => ({ state: 'indexeddb', backend: 'indexeddb', persistent: true, ephemeral: false, degradedReason: null }),
		getRackEffectTypes: () => [], getVideoEffectTypes: () => [], getSelectionEffectTypes: () => [], getSelectionEffectParams: () => ({}),
		getSelectionEffectDefinition: () => null, getEffectPresets: () => [],
	};
}

test('preference publications reuse immutable derived views until the project generation changes', () => {
	let current: SnapshotProject = PROJECT as unknown as SnapshotProject;
	const ports = runtime(() => current), first = createEditorDocumentSnapshot(ports);
	assert.equal(first.timelineAnnotations.length, COUNT);
	assert.equal(first.trackFolders.sequences[0]!.rows.length, COUNT + 1);
	assert.equal(first.masteringSequences.sequences.length, ORDERS);
	const original = Array.prototype.map;
	let annotationVisits = 0;
	Array.prototype.map = function<T, R>(this: T[], transform: (value: T, index: number, array: T[]) => R, receiver?: unknown): R[] {
		return original.call(this, (value: T, index: number, array: T[]) => {
			if (this === PROJECT.timelineAnnotations) annotationVisits++;
			return transform.call(receiver, value, index, array);
		}) as R[];
	};
	try {
		for (let index = 0; index < 5; index++) {
			const next = createEditorDocumentSnapshot({ ...ports, state: stateFixture({ showVerticalRulers: index % 2 === 0 }) });
			assert.equal(next.timeline.showVerticalRulers, index % 2 === 0);
			assert.equal(next.project, first.project);
			assert.equal(next.trackFolders, first.trackFolders);
			assert.equal(next.timelineAnnotations, first.timelineAnnotations);
			assert.equal(next.masteringSequences, first.masteringSequences);
		}
		assert.equal(annotationVisits, 0);
	} finally { Array.prototype.map = original; }
	current = applySoundscaperProjectCommand(PROJECT, { type: 'project/rename', title: 'Replacement generation' }) as unknown as SnapshotProject;
	const changed = createEditorDocumentSnapshot(ports);
	assert.notEqual(changed.project, first.project);
	assert.notEqual(changed.trackFolders, first.trackFolders);
	assert.notEqual(changed.timelineAnnotations, first.timelineAnnotations);
	assert.notEqual(changed.masteringSequences, first.masteringSequences);
	assert.deepEqual(changed.trackFolders, first.trackFolders);
});

test('one mastering document snapshot shares a region lookup across every order', () => {
	const original = Array.prototype.map;
	let visits = 0;
	Array.prototype.map = function<T, R>(this: T[], transform: (value: T, index: number, array: T[]) => R, receiver?: unknown): R[] {
		return original.call(this, (value: T, index: number, array: T[]) => {
			if (this === PROJECT.timelineAnnotations) visits++;
			return transform.call(receiver, value, index, array);
		}) as R[];
	};
	let snapshot: ReturnType<typeof createDocumentMasteringSequenceSnapshot>;
	try {
		snapshot = createDocumentMasteringSequenceSnapshot(PROJECT);
		assert.ok(visits <= COUNT * 2, `${visits} complete region preparation visits for ${ORDERS} orders`);
	} finally { Array.prototype.map = original; }
	assert.equal(snapshot.sequences.length, ORDERS);
	for (const [index, sequence] of snapshot.sequences.entries()) {
		const expected = validateMasteringSequenceV23(PROJECT.masteringSequences[index]!, snapshot.regions);
		assert.equal(sequence.deliverable, expected.valid);
		assert.deepEqual(sequence.issues, expected.issues);
		assert.equal(sequence.totalFrames, 64);
	}
});

test('standalone annotation snapshot builders keep generic mutable callers fresh', () => {
	const project = { ...PROJECT, timelineAnnotations: PROJECT.timelineAnnotations.map(annotation => ({ ...annotation })) };
	const before = createDocumentTimelineAnnotationSnapshot(project);
	project.timelineAnnotations[0]!.name = 'Changed region';
	const after = createDocumentTimelineAnnotationSnapshot(project);
	assert.equal(before[0]!.name, 'Region 0');
	assert.equal(after[0]!.name, 'Changed region');
});
