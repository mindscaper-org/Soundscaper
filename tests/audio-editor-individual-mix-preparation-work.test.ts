import assert from 'node:assert/strict';
import test from 'node:test';

import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { individualPreFaderPrintWidth } from '../src/common/editor/controller/track-audio/internal/mix-render/individual-pre-fader-print.ts';
import { createMixRenderSnapshot } from '../src/common/editor/controller/track-audio/mix-render-model.ts';
import { createMixRenderService, type MixRenderServiceDependencies } from '../src/common/editor/controller/track-audio/internal/mix-render/mix-render-service.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import type { ControllerProject, ControllerSource } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import type { AudioBufferLike } from '../src/common/editor/controller/source/source-audio.ts';

function fixture(count = 20) {
	const base = createSoundscaperProject({ id: 'individual-work',
		sources: [{ id: 'source', storageKey: 'source', frameCount: 4, channelCount: 2, sampleRate: 48_000 }],
		tracks: Array.from({ length: count }, (_, index) => ({ id: `track-${index}`, name: `Track ${index}`, clipIds: [`clip-${index}`], gain: .25 })),
		clips: Array.from({ length: count }, (_, index) => ({ id: `clip-${index}`, sourceId: 'source', timelineStartFrame: 0,
			sourceStartFrame: 0, sourceDurationFrames: 4, durationFrames: 4 })),
		selection: { startFrame: 0, endFrame: 0, trackIds: Array.from({ length: count }, (_, index) => `track-${index}`), clipIds: [] },
		automationLanes: Array.from({ length: count }, (_, index) => ({ id: `gain-${index}`,
			address: { kind: 'strip', strip: { kind: 'track', id: `track-${index}` }, parameterId: 'gain' },
			timebase: 'absolute-samples', points: [{ id: `point-${index}`, position: 0, value: .5 }], segments: [] })) });
	return createSoundscaperProject({ ...base, mixer: { ...base.mixer, edges: base.mixer.edges.map(edge =>
		edge.source.kind === 'track' && Number(edge.source.id.slice(6)) % 2 === 0 ? { ...edge, position: 'pre-fader' } : edge) } });
}

function buffer(channels: Float32Array[]): AudioBufferLike {
	return { length: channels[0]!.length, numberOfChannels: channels.length, sampleRate: 48_000, getChannelData: index => channels[index]! };
}

test('individual snapshots clone retained media and remain independently owned', () => {
	const project = fixture();
	const original = globalThis.structuredClone;
	let tracksCopied = 0, clipsCopied = 0;
	globalThis.structuredClone = function<T>(value: T, options?: StructuredSerializeOptions): T {
		if (value && typeof value === 'object' && 'tracks' in value && 'clips' in value) {
			const record = value as { tracks: unknown[]; clips: unknown[] };
			tracksCopied += record.tracks.length; clipsCopied += record.clips.length;
		}
		return original(value, options);
	};
	try {
		const snapshots = project.tracks.map(track => createMixRenderSnapshot(project as unknown as ControllerProject, [track], { mixDown: false, renderEffects: true }));
		assert.deepEqual(snapshots.map(snapshot => snapshot.tracks.map(track => track.id)), project.tracks.map(track => [track.id]));
		assert.equal(tracksCopied, project.tracks.length);
		assert.equal(clipsCopied, project.clips.length);
		snapshots[0]!.tracks[0] = { ...snapshots[0]!.tracks[0]!, name: 'Changed private track' };
		snapshots[0]!.sources[0] = { ...snapshots[0]!.sources[0]!, storageKey: 'private' };
		assert.equal(project.tracks[0]!.name, 'Track 0');
		assert.equal(snapshots[1]!.sources[0]!.storageKey, 'source');
	} finally { globalThis.structuredClone = original; }
});

test('individual service jobs and commit share one authored pre-fader routing preparation', async () => {
	const project = fixture();
	const authoredEdges = new WeakSet<object>(project.mixer.edges);
	const original = Object.getOwnPropertyDescriptor;
	let edgeReads = 0, rendered = 0, ids = 0;
	let committed: AudioEditorCommand | null = null;
	const persisted: ControllerSource[] = [];
	const dependencies: MixRenderServiceDependencies = {
		lifetime: new EditorControllerLifetime(),
		copy: { v2Required: 'Project required', mixRenderRequiresAudio: 'Audio required', audacitySelectionHint: 'Select audio', audioTrackRequired: 'Audio required',
			rendering: 'Rendering', mixedTrack: 'Mix', mixRender: 'Mix and Render', mixdownTo: 'Mix down', effectInvalidAudio: 'Invalid audio', done: 'Done' },
		derivedSources: {
			uniqueClipSources: () => assert.fail('Not used'), sourceChannelsForEdit: () => assert.fail('Not used'), persistDerivedSource: () => assert.fail('Not used'),
			persistRenderedMixSource: async (audio, name, provenance) => {
				const source: ControllerSource = { id: `render-${persisted.length}`, storageKey: `render-${persisted.length}`, name,
					mimeType: 'audio/wav', frameCount: audio.length, channelCount: audio.numberOfChannels, sampleRate: audio.sampleRate, originalSampleRate: audio.sampleRate, ...(provenance ? { provenance } : {}) };
				persisted.push(source); return { source, buffer: audio, channels: null };
			}, rollbackDerivedSources: async () => undefined,
		},
		store: { beginSourceWrite: () => assert.fail('Offline only') }, sourceBuffers: new Map(), sourceChunkFrames: 65_536, memoryLimitBytes: Number.MAX_SAFE_INTEGER,
		getProject: () => project as unknown as ControllerProject, getSelectedTrackId: () => null, getSelectedClipId: () => null, editingBlocked: () => false,
		captureProject: () => ({ generation: 1, projectId: project.id }), assertProject() {}, createId: prefix => `${prefix}-${++ids}`,
		commit: command => { committed = command; }, preflightStorage: async () => undefined, setProcessing() {}, setStatus() {}, publish() {}, handleError() {},
		rackTailFrames: () => 0, isFixedStereoEffect: () => false,
		renderSnapshot: async snapshot => {
			assert.equal(snapshot.tracks[0]!.id, `track-${rendered++}`);
			return buffer([new Float32Array(4).fill(.25), new Float32Array(4).fill(.25)]);
		},
		getAudioContext: async () => ({}), createBufferFromChannels: async channels => buffer(channels),
		createRenderEngine: () => assert.fail('Offline only'), createStreamingWriter: () => assert.fail('Offline only'),
		prepareCommittedTimePitchCaches: async () => undefined, activateStoredSource: async () => undefined,
	};
	Object.getOwnPropertyDescriptor = (value: object, key: PropertyKey) => {
		if (authoredEdges.has(value) && key === 'id') edgeReads++;
		return original(value, key);
	};
	try {
		await createMixRenderService(dependencies).mixAndRenderTracks({ mixDown: false, renderEffects: true, replaceOriginals: true });
		assert.equal(rendered, project.tracks.length);
		assert.equal(persisted.length, project.tracks.length);
		assert.ok(edgeReads <= project.mixer.edges.length * 5, `${edgeReads} authored edge ID descriptor reads`);
	} finally { Object.getOwnPropertyDescriptor = original; }
	assert.ok(committed);
	const applied = applySoundscaperProjectCommand(project, committed, { now: '2026-10-26T00:00:00.000Z' });
	assert.deepEqual(applied.tracks.map(track => track.id), project.tracks.map(track => track.id));
	assert.deepEqual(applied.tracks.map(track => track.gain), project.tracks.map((_, index) => index % 2 === 0 ? .25 : 1));
	assert.equal(applied.clips.length, project.tracks.length);
	assert.deepEqual(applied.automationLanes.map(lane => lane.id), project.tracks.flatMap((_, index) => index % 2 === 0 ? [`gain-${index}`] : []));
});

test('standalone pre-fader queries observe fresh routing on generic mutable callers', () => {
	const project = { ...fixture(1) }, target = project.tracks[0]!;
	assert.equal(individualPreFaderPrintWidth(project as unknown as ControllerProject, target), 2);
	project.mixer = { ...project.mixer, edges: project.mixer.edges.map(edge => ({ ...edge, position: 'post-fader' as const })) };
	assert.equal(individualPreFaderPrintWidth(project as unknown as ControllerProject, target), null);
});
