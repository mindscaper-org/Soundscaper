/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createLocalAssistanceVideoKeyingPublication,
	type LocalAssistanceKeyedVideoInspection,
} from '../src/common/editor/controller/assistance/internal/video/local-assistance-video-keying-publication.ts';
import { publishImportedVideo } from '../src/common/editor/controller/import/internal/source-import-video-publication.ts';
import { digestMediaContent } from '../src/common/media/content-digest.ts';
import type { OwnedMediaAssetWriter } from '../src/common/editor/storage/media-asset-write-contract.ts';
import { createVideoTimingAssetPublication } from '../src/common/editor/video-timing-asset.ts';
import { createUnreportedVideoSourceCharacteristicsV25 } from '../src/common/editor/video-source-professional-characteristics-v25.ts';
import {
	createFramescaperProjectAssistance,
	type FramescaperProjectAssistance,
} from '../src/framescaper/editor-project-assistance.ts';
import {
	createFramescaperProjectHistoryAssistance,
	executeFramescaperProjectCommandAssistance,
	undoFramescaperProjectCommandAssistance,
	redoFramescaperProjectCommandAssistance,
} from '../src/framescaper/editor-project-assistance-history.ts';
import { FRAMESCAPER_ASSISTANCE_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type Data = Readonly<Record<string, unknown>>;
const PROFILE = FRAMESCAPER_ASSISTANCE_PROJECT_RUNTIME_PROFILE;
const NOW = '2026-10-22T16:00:00.000Z';
const BODY = new Blob([Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4)], { type: 'video/webm' });

function sourceProject(): FramescaperProjectAssistance {
	const options = framescaperV20Options();
	options.selection = { startFrame: 0, endFrame: 48_000,
		trackIds: ['video-track'], clipIds: ['video-clip'], frequencyRange: null, annotationIds: [] };
	return createFramescaperProjectAssistance(PROFILE, options as never);
}

function inspection(): { -readonly [Key in keyof LocalAssistanceKeyedVideoInspection]: LocalAssistanceKeyedVideoInspection[Key] } {
	return {
		width: 1_920, height: 1_080, frameRate: { num: 10, den: 1 },
		timing: { timescale: 1_000, presentationTicks: Array.from({ length: 10 }, (_, i) => BigInt(i * 100)),
			finalFrameDurationTicks: 100n },
		characteristics: { ...createUnreportedVideoSourceCharacteristicsV25(),
			backend: 'keying-output-probe', codedWidth: 1_920, codedHeight: 1_080,
			videoCodec: 'vp9', hasAlpha: true, bitDepth: 8, pixelFormat: 'yuva420p',
			alphaMode: 'straight', alphaInterpretation: 'transparency',
			rotationDegrees: 0, pixelAspectRatio: { num: 1, den: 1 }, audioStreams: [],
		},
	};
}

function harness(original = sourceProject()) {
	let history = createFramescaperProjectHistoryAssistance(PROFILE, original);
	let current: unknown = null;
	let selectedClipId = 'video-clip';
	let readOnly = false;
	let serial = 0;
	let inspected = inspection();
	const records = new Map<string, { body: Blob; metadata: Data }>();
	const events: string[] = [];
	let beforeWrite: (() => void) | undefined;
	let beforeCommit: (() => void) | undefined;
	let beforeReload: (() => void) | undefined;
	let afterCommit: (() => void) | undefined;
	const getProject = () => current ?? history.present;
	const store = {
		async getMediaAssetMetadata(key: string) { return records.get(key)?.metadata ?? null; },
		async loadMediaAsset(key: string) { return records.get(key)?.body ?? null; },
		async beginMediaAssetWrite(key: string, metadata: Data,
			admission: Readonly<{ expectedBytes: number; expectedSha256: string }>): Promise<OwnedMediaAssetWriter> {
			events.push(`begin:${key}`);
			const chunks: Uint8Array<ArrayBuffer>[] = [];
			let bytesWritten = 0;
			return {
				maximumChunkBytes: 4,
				get bytesWritten() { return bytesWritten; },
				async write(bytes: Uint8Array) {
					beforeWrite?.();
					chunks.push(Uint8Array.from(bytes)); bytesWritten += bytes.byteLength;
				},
				async commit() { throw new Error('Ownership is required.'); },
				async commitOwned() {
					const published = { body: new Blob(chunks), metadata: {
						...metadata, sourceId: key, size: bytesWritten, sha256: admission.expectedSha256,
					} };
					records.set(key, published);
					return { metadata: published.metadata, async discardIfCurrent() {
						events.push(`discard:${key}`);
						if (records.get(key) !== published) return false;
						records.delete(key); return true;
					} };
				},
				async abort() { events.push(`abort:${key}`); },
			};
		},
	};
	const publication = createLocalAssistanceVideoKeyingPublication({
		getProject, getSelectedClipId: () => selectedClipId, isReadOnly: () => readOnly,
		captureProject: getProject, assertProject: (token) => assert.strictEqual(token, getProject()),
		createId: (prefix) => `${prefix}-${String(++serial)}`,
		preflightStorage: async (bytes) => { events.push(`preflight:${String(bytes)}`); },
		store, inspectOutput: async () => inspected,
		publishContent: async ({ storageKey, body, metadata, signal }) => (
			(await publishImportedVideo(store, storageKey, body, metadata, signal)).publication
		),
		commit(command) {
			beforeCommit?.();
			history = executeFramescaperProjectCommandAssistance(PROFILE, history, command, { now: NOW });
			events.push('commit');
			afterCommit?.();
		},
		reloadSourceVisual: async (id) => { beforeReload?.(); events.push(`reload:${id}`); },
	});
	return {
		publication, records, events, store,
		get project() { return history.present; },
		setCurrent(value: unknown) { current = value; },
		setSelection(value: string) { selectedClipId = value; },
		setReadOnly(value: boolean) { readOnly = value; },
		setInspection(value: LocalAssistanceKeyedVideoInspection) { inspected = value; },
		onWrite(callback: () => void) { beforeWrite = callback; },
		onCommit(callback: () => void) { beforeCommit = callback; },
		onReload(callback: () => void) { beforeReload = callback; },
	onAfterCommit(callback: () => void) { afterCommit = callback; },
		undo() { history = undoFramescaperProjectCommandAssistance(PROFILE, history, { now: NOW }); },
		redo() { history = redoFramescaperProjectCommandAssistance(PROFILE, history, { now: NOW }); },
	};
}

async function result() {
	return { body: BODY, sha256: await digestMediaContent(BODY),
		modelId: 'corridorkey-2.0', modelVersion: '2.0' };
}

function rows(value: unknown): Data[] { return value as Data[]; }

test('keying publishes the full source and changes only the chosen occurrence through undo and redo', async () => {
	const original = sourceProject();
	const fixture = harness(original);
	const run = await fixture.publication.capture();
	assert.equal(run.sourceFrameCount, 10);
	assert.equal(run.source.id, 'video-source');
	const accepted = await fixture.publication.accept(run, await result());
	assert.equal(accepted.sourceId, 'keyed-video-1');
	const source = rows(fixture.project.sources).find(({ id }) => id === accepted.sourceId)!;
	assert.equal(source.mimeType, 'video/webm');
	assert.equal(source.sourceFrameCount, 10);
	assert.deepEqual(source.frameRate, { num: 10, den: 1 });
	assert.equal((source.characteristics as Data).hasAlpha, true);
	assert.equal(source.proxyAttachment, null);
	assert.equal(source.imageSequence, null);
	const actualClip = rows(fixture.project.clips).find(({ id }) => id === 'video-clip')!;
	const originalClip = rows(original.clips).find(({ id }) => id === 'video-clip')!;
	const restoredClip: Record<string, unknown> = { ...actualClip, sourceId: originalClip.sourceId };
	delete restoredClip.renderCacheRevision;
	assert.deepEqual(restoredClip, originalClip);
	assert.deepEqual(fixture.project.projectBin, original.projectBin);
	assert.equal(fixture.records.size, 2);
	assert.equal(fixture.events.filter((event) => event === 'commit').length, 1);
	fixture.undo();
	assert.deepEqual(fixture.project.sources, original.sources);
	assert.deepEqual(fixture.project.clips, original.clips);
	assert.equal(fixture.records.size, 2);
	fixture.redo();
	assert.equal(rows(fixture.project.clips)[0]!.sourceId, accepted.sourceId);
	assert.equal(fixture.records.size, 2);
	await assert.rejects(fixture.publication.accept(run, await result()), /already accepted/u);
});

test('keying refuses read-only documents and locked tracks before capture', async () => {
	const fixture = harness(); fixture.setReadOnly(true);
	await assert.rejects(fixture.publication.capture(), /read.only/u);
	fixture.setReadOnly(false);
	const locked = structuredClone(fixture.project) as unknown as Record<string, unknown>;
	(rows(locked.tracks)[0] as Record<string, unknown>).locked = true;
	fixture.setCurrent(locked);
	await assert.rejects(fixture.publication.capture(), /locked/u);
	assert.equal(fixture.records.size, 0);
});

test('captured decode authority binds the full original ordinal extent to one publication instance', async () => {
	const fixture = harness(); const run = await fixture.publication.capture();
	assert.equal(run.selectionFence.sourceStartFrame, 0);
	assert.equal(run.selectionFence.sourceEndFrame, run.sourceFrameCount);
	assert.equal(run.presentationTick(0), 0n);
	assert.ok(run.sourceEndTick > run.presentationTick(run.sourceFrameCount - 1));
	fixture.publication.assertCurrent(run);
	assert.throws(() => fixture.publication.assertCurrent({ ...run }), /no longer available/u);
	assert.throws(() => harness().publication.assertCurrent(run), /no longer available/u);
	assert.throws(() => run.presentationTick(run.sourceFrameCount), /ordinal/u);
	fixture.setSelection('another-clip');
	assert.throws(() => fixture.publication.assertCurrent(run), /selection|selected|changed/iu);
});
test('transient Framescaper focus admits one video and changing focus invalidates its captured authority', async () => {
	const fixture = harness();
	fixture.setCurrent({ ...fixture.project, selection: { ...fixture.project.selection, clipIds: [] } });
	const run = await fixture.publication.capture();
	assert.equal(run.clipId, 'video-clip'); fixture.publication.assertCurrent(run);
	fixture.setSelection('another-clip');
	assert.throws(() => fixture.publication.assertCurrent(run), /video occurrence|keying/u);
});

test('keying refuses a changed selection, source, project activation, or writable state', async () => {
	for (const mutation of ['selection', 'source', 'activation', 'read-only'] as const) {
		const fixture = harness(); const run = await fixture.publication.capture();
		if (mutation === 'selection') fixture.setSelection('other-clip');
		if (mutation === 'read-only') fixture.setReadOnly(true);
		if (mutation === 'source') {
			const changed = structuredClone(fixture.project) as unknown as Record<string, unknown>;
			(rows(changed.sources)[0] as Record<string, unknown>).contentSha256 = 'ab'.repeat(32);
			fixture.setCurrent(changed);
		}
		if (mutation === 'activation') fixture.setCurrent(structuredClone(fixture.project));
		await assert.rejects(fixture.publication.accept(run, await result()));
		assert.equal(fixture.records.size, 0);
		assert.equal(fixture.events.length, 0);
	}
});

test('keying authenticates output bytes and refuses lost alpha, geometry, rate, inventory, or timing', async () => {
	for (const defect of ['digest', 'alpha', 'width', 'rate', 'count', 'timestamp', 'duration'] as const) {
		const fixture = harness(); const run = await fixture.publication.capture();
		const candidate = await result(); const inspected = inspection();
		if (defect === 'digest') candidate.sha256 = 'ab'.repeat(32);
		if (defect === 'alpha') inspected.characteristics = { ...inspected.characteristics, hasAlpha: false };
		if (defect === 'width') inspected.width = 1_280;
		if (defect === 'rate') inspected.frameRate = { num: 25, den: 1 };
		if (defect === 'count') inspected.timing = { ...inspected.timing, presentationTicks: [0n] };
		if (defect === 'timestamp') inspected.timing = { ...inspected.timing,
			presentationTicks: [0n, 120n, ...inspected.timing.presentationTicks.slice(2)] };
		if (defect === 'duration') inspected.timing = { ...inspected.timing, finalFrameDurationTicks: 120n };
		fixture.setInspection(inspected);
		await assert.rejects(fixture.publication.accept(run, candidate));
		assert.equal(fixture.records.size, 0, defect);
		assert.ok(!fixture.events.some((event) => event.startsWith('begin:')), defect);
	}
});

test('keying accepts only the explicitly bounded one millisecond output quantization', async () => {
	const fixture = harness(); const run = await fixture.publication.capture();
	const inspected = inspection();
	inspected.timing = { ...inspected.timing,
		presentationTicks: [0n, 101n, ...inspected.timing.presentationTicks.slice(2)] };
	fixture.setInspection(inspected);
	await fixture.publication.accept(run, await result());
	assert.equal(fixture.records.size, 2);
});

test('keying refuses genuinely variable source timing before starting model work', async () => {
	const original = structuredClone(sourceProject()) as unknown as Record<string, unknown>;
	const source = rows(original.sources)[0] as Record<string, unknown>;
	const timing = createVideoTimingAssetPublication(String(source.contentSha256), {
		timescale: 1_000, presentationTicks: [0n, 120n, 200n, 300n, 400n, 500n, 600n, 700n, 800n, 900n],
		finalFrameDurationTicks: 100n,
	});
	source.timingAsset = timing.reference;
	const fixture = harness();
	fixture.setCurrent(original);
	fixture.records.set(timing.reference.storageKey, { body: new Blob([Uint8Array.from(timing.bytes)]),
		metadata: { sha256: timing.reference.sha256, size: timing.reference.byteLength } });
	await assert.rejects(fixture.publication.capture(), /constant.frame.rate/u);
	assert.equal(fixture.records.size, 1);
});

test('stale authority during storage rolls back both owned bodies before history publication', async () => {
	const fixture = harness(); const run = await fixture.publication.capture();
	fixture.onWrite(() => fixture.setSelection('other-clip'));
	await assert.rejects(fixture.publication.accept(run, await result()));
	assert.equal(fixture.records.size, 0);
	assert.ok(fixture.events.some((event) => event.startsWith('discard:')));
	assert.ok(!fixture.events.includes('commit'));
});

test('cancellation during storage leaves no derived media or history entry', async () => {
	const fixture = harness(); const run = await fixture.publication.capture();
	const cancellation = new AbortController();
	fixture.onWrite(() => cancellation.abort(new Error('keying cancelled')));
	await assert.rejects(fixture.publication.accept(run, await result(), { signal: cancellation.signal }), /keying cancelled/u);
	assert.equal(fixture.records.size, 0);
	assert.ok(fixture.events.some((event) => event.startsWith('abort:')));
	assert.ok(!fixture.events.includes('commit'));
});

test('failed history admission cleans storage, but failed visual reload retains the accepted history bodies', async () => {
	const rejected = harness(); const rejectedRun = await rejected.publication.capture();
	rejected.onCommit(() => { throw new Error('history rejected'); });
	await assert.rejects(rejected.publication.accept(rejectedRun, await result()), /history rejected/u);
	assert.equal(rejected.records.size, 0);
	const accepted = harness(); const acceptedRun = await accepted.publication.capture();
	accepted.onReload(() => { throw new Error('preview failed'); });
	await assert.rejects(accepted.publication.accept(acceptedRun, await result()), /preview failed/u);
	assert.equal(accepted.records.size, 2);
	assert.ok(accepted.events.includes('commit'));
	accepted.undo(); accepted.redo();
	assert.equal(rows(accepted.project.clips)[0]!.sourceId, 'keyed-video-1');
});


test('full-source publication preserves a trimmed retime and the other occurrence sharing its original', async () => {
	const options = framescaperV20Options();
	options.selection = { startFrame: 0, endFrame: 48_000,
		trackIds: ['video-track'], clipIds: ['video-clip'], frequencyRange: null, annotationIds: [] };
	const sourceClip = rows(options.clips)[0]!;
	options.clips = [
		{ ...sourceClip, sequenceStartFrame: 3, sequenceFrameCount: 3, sourceInFrame: 2,
			sourceFrameCount: 6, retimeMap: {
				feature: 'video-retime', version: 2,
				points: [{ outerFrame: 0, sourceFrame: { num: 2, den: 1 } },
					{ outerFrame: 3, sourceFrame: { num: 8, den: 1 } }],
				segments: [{ mode: 'constant-forward' }],
			},
		},
		...rows(options.clips).slice(1),
		{ ...sourceClip, id: 'other-video-clip', sequenceStartFrame: 12 },
	];
	options.tracks = rows(options.tracks).map((track) => track.id === 'video-track'
		? { ...track, clipIds: ['video-clip', 'other-video-clip'] } : track);
	const original = createFramescaperProjectAssistance(PROFILE, options as never);
	const fixture = harness(original);
	const run = await fixture.publication.capture();
	assert.equal(run.sourceFrameCount, 10);
	const accepted = await fixture.publication.accept(run, await result());
	const originalClip = rows(original.clips).find(({ id }) => id === 'video-clip')!;
	const replaced = rows(fixture.project.clips).find(({ id }) => id === 'video-clip')!;
	assert.equal(replaced.sourceId, accepted.sourceId);
	assert.equal(replaced.sourceInFrame, originalClip.sourceInFrame);
	assert.equal(replaced.sourceFrameCount, originalClip.sourceFrameCount);
	assert.equal(replaced.sequenceStartFrame, originalClip.sequenceStartFrame);
	assert.equal(replaced.sequenceFrameCount, originalClip.sequenceFrameCount);
	assert.deepEqual(replaced.retimeMap, originalClip.retimeMap);
	assert.deepEqual(rows(fixture.project.clips).find(({ id }) => id === 'other-video-clip'),
		rows(original.clips).find(({ id }) => id === 'other-video-clip'));
	fixture.undo(); fixture.redo();
	assert.deepEqual(rows(fixture.project.clips).find(({ id }) => id === 'video-clip')?.retimeMap, originalClip.retimeMap);
});

test('post-admission callback failure never reclaims media retained by the published history', async () => {
	const fixture = harness(); const run = await fixture.publication.capture();
	fixture.onAfterCommit(() => { throw new Error('post-admission notification failed'); });
	await assert.rejects(fixture.publication.accept(run, await result()), /notification failed/u);
	assert.equal(fixture.records.size, 2);
	fixture.undo(); fixture.redo();
	assert.equal(rows(fixture.project.clips)[0]!.sourceId, 'keyed-video-1');
});

test('uncertain history ownership preserves both failure causes and the possibly referenced bodies', async () => {
	const fixture = harness(); const run = await fixture.publication.capture();
	const admissionFailure = new Error('admission notification failed');
	const ownershipFailure = new Error('current history cannot be read');
	fixture.onAfterCommit(() => {
		fixture.setCurrent({ id: run.projectId, get sources() { throw ownershipFailure; } });
		throw admissionFailure;
	});
	await assert.rejects(fixture.publication.accept(run, await result()), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.deepEqual(error.errors, [admissionFailure, ownershipFailure]);
		assert.strictEqual(error.cause, admissionFailure);
		return true;
	});
	assert.equal(fixture.records.size, 2);
});
