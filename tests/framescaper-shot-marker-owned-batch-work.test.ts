/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { createFramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';
import { applyFramescaperProjectCommandNativeMedia, type FramescaperProjectCommandNativeMedia } from '../src/framescaper/editor-project-native-media-commands.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE as profile } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { resolveLocalAssistanceSelectedVideoAuthority } from '../src/common/editor/controller/assistance/local-assistance-selected-video.ts';
import { createLocalAssistanceShotAcceptance } from '../src/common/editor/controller/assistance/internal/local-assistance-shot-acceptance.ts';
import { createTimelineAnnotationsV11 } from '../src/common/editor/timeline-annotation.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { brandRuntimeProjectProjection, resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { dispatchTimelineAnnotationAppendRuns } from '../src/common/editor/commands/timeline-annotation-add-batch.ts';

function fixture(count: number) {
	const sourceFrames = count + 2, options = framescaperV20Options();
	const source = (options.sources as Record<string, unknown>[]).find((row) => row.kind === 'video')!;
	source.frameCount = sourceFrames * 4800; source.sampleFrameCount = sourceFrames * 4800; source.sourceFrameCount = sourceFrames;
	options.sources = [source];
	options.clips = (options.clips as Record<string, unknown>[]).filter((clip) => clip.kind === 'video').map((clip) => ({ ...clip,
		sequenceFrameCount: sourceFrames, sourceFrameCount: sourceFrames, avLinkId: null }));
	options.tracks = (options.tracks as Record<string, unknown>[]).filter((track) => track.type === 'video');
	(options.sequences as Record<string, unknown>[])[0]!.trackIds = (options.tracks as Record<string, unknown>[]).map((track) => track.id);
	const clipId = String((options.clips as Record<string, unknown>[])[0]!.id);
	options.selection = { startFrame: 0, endFrame: 0, trackIds: [(options.tracks as Record<string, unknown>[])[0]!.id], clipIds: [clipId] };
	const project = createFramescaperProjectNativeMedia(profile, options);
	const authority = resolveLocalAssistanceSelectedVideoAuthority({ getProject: () => project, getSelectedClipId: () => clipId });
	return { project, authority, sourceFrames, source };
}

test('actual500-cut acceptance retains every command and marker while canonicalizing the owned append run once', async (context) => {
	const count = 500, { project, authority, sourceFrames, source } = fixture(count);
	const review = { kind: 'shot-boundaries', schemaVersion: 1, detector: 'ffmpeg-scdet', timescale: 90000,
		sourceFrameCount: sourceFrames, boundaries: Array.from({ length: count }, (_, index) => ({ sourceFrame: index + 1, presentationTick: String((index + 1) * 9000), score: 1 })) };
	const { kind: _, ...wire } = review, bytes = new TextEncoder().encode(JSON.stringify(wire));
	const captured: { value?: FramescaperProjectCommandNativeMedia } = {};
	const acceptance = createLocalAssistanceShotAcceptance({ currentAuthority: () => authority,
		captureProject: () => project, assertProject: (token) => assert.equal(token, project), commit: (command) => { captured.value = command as unknown as FramescaperProjectCommandNativeMedia; } });
	await acceptance.acceptValidatedResult({ sourceId: source.id, operation: 'shot-detection', selectionFence: authority.fence, models: [], outputs: [{
		claim: { claimVersion: 1, claimId: '1'.repeat(40), jobId: '2'.repeat(40), role: 'shot-boundaries',
			mediaType: 'application/vnd.soundscaper.shot-boundaries+json', byteLength: bytes.byteLength,
			sha256: createHash('sha256').update(bytes).digest('hex') }, review }] });
	const command = captured.value!;
	assert.equal(command.type, 'batch');
	if (command.type !== 'batch' || !('commands' in command)) throw new Error('missing marker batch');
	const children = command.commands as readonly { type: string; annotation: unknown }[];
	assert.equal(children.length, count);
	const expected = createTimelineAnnotationsV11(children.map((child) => child.annotation), { sampleRate: Number(project.sampleRate),
		tempoMap: project.tempoMap as import('../src/common/editor/timeline-time.ts').HoldTempoMap,
		sequenceIds: (project.sequences as readonly { id: string }[]).map((sequence) => sequence.id) });
	const map = Array.prototype.map; let rows = 0;
	Object.defineProperty(Array.prototype, 'map', { configurable: true, writable: true,
		value: function (this: unknown[], callback: (value: unknown, index: number, values: unknown[]) => unknown, receiver?: unknown) {
			if (this[0] && typeof this[0] === 'object' && 'kind' in this[0] && this[0].kind === 'marker'
				&& new Error().stack?.includes('createTimelineAnnotationsV11')) rows += this.length;
			return map.call(this, callback, receiver);
		} });
	context.after(() => Object.defineProperty(Array.prototype, 'map', { configurable: true, writable: true, value: map }));
	const applied = applyFramescaperProjectCommandNativeMedia(profile, project, command);
	assert.deepEqual(applied.timelineAnnotations, expected);
	assert.equal(applied.revision, Number(project.revision) + 1);
	assert.deepEqual(project.timelineAnnotations, []);
	assert.ok(rows <= count * 8, `${String(rows)} normalized marker rows`);
	context.diagnostic(`${String(rows)} normalized marker rows for ${String(count)} accepted cuts.`);
	const malformed = structuredClone(command) as unknown as { type: 'batch'; commands: { annotation: { id: string } }[] };
	malformed.commands.at(-1)!.annotation.id = malformed.commands[0]!.annotation.id;
	assert.throws(() => applyFramescaperProjectCommandNativeMedia(profile, project, malformed as never), /duplicate|unique|repeat/i);
	assert.deepEqual(project.timelineAnnotations, []);
});

test('current Frame append runs preserve interleaved and nested edits and refuse later locked children atomically', () => {
	const { project } = fixture(8);
	const original = structuredClone(project);
	const marker = (id: string, positionFrame: number) => ({ type: 'timeline-annotation/add' as const, annotation: {
		id, sequenceId: String((project.sequences as readonly { id: string }[])[0]!.id), name: '', color: 'auto' as const,
		batchId: null, opaqueExtensions: {}, kind: 'marker' as const, anchor: 'sample' as const, positionFrame,
	} });
	const command: FramescaperProjectCommandNativeMedia = { type: 'batch', commands: [
		marker('first', 1), marker('second', 2),
		{ type: 'batch', commands: [
			{ type: 'timeline-annotation/update-many', annotationIds: ['first'], changes: { name: 'Interleaved' } },
			marker('third', 3), marker('fourth', 4),
		] },
	] };
	const applied = applyFramescaperProjectCommandNativeMedia(profile, project, command);
	assert.deepEqual((applied.timelineAnnotations as readonly { id: string; name: string }[]).map(row => [row.id, row.name]),
		[['first', 'Interleaved'], ['second', ''], ['third', ''], ['fourth', '']]);
	assert.deepEqual(project, original);
	const trackId = String((project.tracks as readonly { id: string }[])[0]!.id);
	const clipId = String((project.clips as readonly { id: string }[])[0]!.id);
	assert.throws(() => applyFramescaperProjectCommandNativeMedia(profile, project, { type: 'batch', commands: [
		marker('first', 1), marker('second', 2),
		{ type: 'track/update', trackId, changes: { locked: true } },
		{ type: 'batch', commands: [{ type: 'clip/update', clipId, changes: { title: 'Refused' } }] },
	] }), /locked/iu);
	assert.deepEqual(project, original);
	let reads = 0;
	const hostile = marker('hostile', 3);
	Object.defineProperty(hostile, 'annotation', { enumerable: true, get() { reads += 1; return marker('accessor', 3).annotation; } });
	const canonical = createCurrentAudioEditorProject({ id: 'append-run-closed-fields' });
	const draft = brandRuntimeProjectProjection(structuredClone(resolveRuntimeProjectProjection(canonical)));
	assert.throws(() => dispatchTimelineAnnotationAppendRuns(draft, [marker('first', 1), hostile], () => {
		assert.fail('A malformed append run cannot dispatch even its first child.');
	}), /data|accessor/iu);
	assert.equal(reads, 0);
	assert.deepEqual(draft.timelineAnnotations, []);
	assert.deepEqual(project, original);
});
