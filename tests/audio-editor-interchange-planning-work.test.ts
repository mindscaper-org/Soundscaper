import assert from 'node:assert/strict';
import test from 'node:test';

import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { createDeliveryReport, sealDeliveryReport } from '../src/common/editor/delivery-report.ts';
import { reportInterchangeAudioOmissions } from '../src/common/editor/controller/export/internal/interchange-audio-omissions.ts';
import { createOtioExport } from '../src/common/editor/otio-export.ts';
import { createFcpxmlExport } from '../src/common/editor/fcpxml-export.ts';

type Data = Readonly<Record<string, unknown>>;
function record(value: unknown): Data { assert.ok(value && typeof value === 'object' && !Array.isArray(value)); return value as Data; }
function records(value: unknown): Data[] { assert.ok(Array.isArray(value)); return value.map((item: unknown) => record(item)); }

const COUNT = 500;
const AUTOMATED = projectForRuntimeConsumers(createSoundscaperProject({ id: 'omission-work',
	sources: [{ id: 'source', storageKey: 'source.wav', frameCount: 64, sampleRate: 48_000, channelCount: 1 }],
	tracks: Array.from({ length: COUNT }, (_, index) => ({ id: `track-${index}`, clipIds: [`clip-${index}`] })),
	clips: Array.from({ length: COUNT }, (_, index) => ({ id: `clip-${index}`, sourceId: 'source', timelineStartFrame: 0,
		sourceStartFrame: 0, sourceDurationFrames: 64, durationFrames: 64 })),
	automationLanes: Array.from({ length: COUNT }, (_, index) => ({ id: `lane-${index}`,
		address: { kind: 'strip', strip: { kind: 'track', id: `track-${index}` }, parameterId: 'gain' }, timebase: 'absolute-samples',
		points: [{ id: `point-${index}`, position: 0, value: .5 }], segments: [] })) }));

test('interchange omission reporting prepares track-owned automation once per delivered project', () => {
	const pointArrays = new Set<unknown>(AUTOMATED.automationLanes.map(lane => lane.points));
	const original = Array.prototype.filter;
	let catalogs = 0, points = 0;
	Array.prototype.filter = function<T>(this: T[], predicate: (value: T, index: number, array: T[]) => unknown, receiver?: unknown): T[] {
		return original.call(this, (value: T, index: number, array: T[]) => {
			if (this === AUTOMATED.automationLanes) catalogs++;
			if (pointArrays.has(this)) points++;
			return predicate.call(receiver, value, index, array);
		}) as T[];
	};
	try {
		for (const format of ['otio', 'fcpxml']) {
			catalogs = 0; points = 0;
			const report = reportInterchangeAudioOmissions(sealDeliveryReport(createDeliveryReport({ format })), AUTOMATED);
			assert.equal(report.items.length, COUNT);
			for (const [index, item] of report.items.entries()) {
				assert.deepEqual(item.scope, { kind: 'track', id: `track-${index}` });
				assert.deepEqual(item.data.automationLanes, [`lane-${index}`]);
			}
			assert.ok(catalogs <= COUNT * 2, `${catalogs} automation catalog visits`);
			assert.ok(points <= COUNT * 2, `${points} automation point visits`);
		}
	} finally { Array.prototype.filter = original; }
});

const OVERLAPPING = projectForRuntimeConsumers(createSoundscaperProject({ id: 'lane-work',
	sources: [{ id: 'source', storageKey: 'source.wav', frameCount: 4_800, sampleRate: 48_000, channelCount: 1 }],
	tracks: [{ id: 'audio', clipIds: Array.from({ length: COUNT }, (_, index) => `clip-${index}`) }],
	clips: Array.from({ length: COUNT }, (_, index) => ({ id: `clip-${index}`, sourceId: 'source', timelineStartFrame: 0,
		sourceStartFrame: 0, sourceDurationFrames: 4_800, durationFrames: 4_800 })) }));

test('overlapping audio interchange packing does bounded work while retaining all parallel lanes', () => {
	let visits = 0;
	const find = Array.prototype.find, findIndex = Array.prototype.findIndex;
	Array.prototype.find = function<T>(this: T[], predicate: (value: T, index: number, array: T[]) => unknown, receiver?: unknown): T | undefined {
		const measured = new Error().stack?.includes('laneFor');
		return find.call(this, measured ? (value: T, index: number, array: T[]) => { visits++; return predicate.call(receiver, value, index, array); } : predicate, receiver) as T | undefined;
	};
	Array.prototype.findIndex = function<T>(this: T[], predicate: (value: T, index: number, array: T[]) => unknown, receiver?: unknown): number {
		const measured = new Error().stack?.includes('buildTracks');
		return findIndex.call(this, measured ? (value: T, index: number, array: T[]) => { visits++; return predicate.call(receiver, value, index, array); } : predicate, receiver);
	};
	try {
		const request = { project: OVERLAPPING, sequenceRate: { num: 30, den: 1 } };
		const otio = createOtioExport(request), fcpxml = createFcpxmlExport(request);
		assert.equal(records(record(otio.document.tracks).children).length, COUNT);
		assert.equal((fcpxml.text.match(/<asset-clip\b/gu) ?? []).length, COUNT);
		assert.ok(visits <= COUNT * 4, `${visits} occupied-lane comparisons`);
	} finally { Array.prototype.find = find; Array.prototype.findIndex = findIndex; }
});

test('serial lane reuse keeps first eligible lane, half-open boundaries and global FCP reservations', () => {
	const intervals = [[0, 20], [0, 8], [5, 5], [8, 4], [10, 5], [12, 8], [20, 4]];
	const expected = [0, 1, 2, 1, 2, 1, 0];
	const project = projectForRuntimeConsumers(createSoundscaperProject({ id: 'lane-reuse',
		sources: [{ id: 'source', storageKey: 'source.wav', frameCount: 64, sampleRate: 48_000, channelCount: 1 }],
		tracks: [{ id: 'audio', clipIds: intervals.map((_, index) => `clip-${index}`).reverse() }, { id: 'other', clipIds: ['extra'] }],
		clips: [...intervals.map(([start, duration], index) => ({ id: `clip-${index}`, title: `clip-${index}`, sourceId: 'source',
			timelineStartFrame: start, sourceStartFrame: 0, sourceDurationFrames: duration, durationFrames: duration })),
			{ id: 'extra', title: 'extra', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 4, durationFrames: 4 }] }));
	const request = { project, sequenceRate: { num: 30, den: 1 } };
	const otio = createOtioExport(request), fcpxml = createFcpxmlExport(request);
	const actual = new Map<string, number>();
	for (const [lane, track] of records(record(otio.document.tracks).children).entries()) {
		for (const clip of records(track.children)) if (clip.OTIO_SCHEMA === 'Clip.1') actual.set(String(clip.name), lane);
	}
	assert.deepEqual(intervals.map((_, index) => actual.get(`clip-${index}`)), expected);
	const fcpLanes = new Map([...fcpxml.text.matchAll(/<asset-clip\b[^>]*name="([^"]*)"[^>]*lane="(-?\d+)"/gu)].map(match => [match[1]!, Number(match[2])]));
	assert.deepEqual(intervals.map((_, index) => fcpLanes.get(`clip-${index}`)), expected.map(lane => -(lane + 1)));
	assert.equal(fcpLanes.get('extra'), -4);
});

test('owned automation indexing preserves reachable bus mute lanes in authored report order', () => {
	const base = createSoundscaperProject({ id: 'bus-lane-report',
		sources: [{ id: 'source', storageKey: 'source.wav', frameCount: 64, sampleRate: 48_000, channelCount: 2 }],
		tracks: ['a', 'b'].map(id => ({ id, clipIds: [`clip-${id}`] })),
		clips: ['a', 'b'].map(id => ({ id: `clip-${id}`, sourceId: 'source', timelineStartFrame: 0,
			sourceStartFrame: 0, sourceDurationFrames: 64, durationFrames: 64 })) });
	const project = projectForRuntimeConsumers(createSoundscaperProject({ ...base, mixer: { ...base.mixer,
		groups: [{ id: 'bus', name: 'Bus', color: '#555555', gain: 1, pan: 0, mute: false, solo: false,
			collapsed: false, effectsActive: true, effects: [], channelCount: 2 }],
		edges: [...base.mixer.edges.map(edge => edge.source.kind === 'track' && edge.source.id === 'a'
			? { ...edge, destination: { kind: 'mixer-node', id: 'bus' } } : edge),
			{ id: 'bus-main', kind: 'assignment', source: { kind: 'mixer-node', id: 'bus' }, destination: { kind: 'master' },
				position: 'post-fader', enabled: true, level: 1, channelMap: [0, 1] }],
	}, automationLanes: [
		{ id: 'bus-mute', address: { kind: 'strip', strip: { kind: 'mixer-node', id: 'bus' }, parameterId: 'mute' }, timebase: 'absolute-samples',
			points: [{ id: 'open', position: 0, value: 0 }, { id: 'closed', position: 64, value: 1 }], segments: [{ kind: 'hold' }] },
		...['a', 'b'].map(id => ({ id: `gain-${id}`, address: { kind: 'strip', strip: { kind: 'track', id }, parameterId: 'gain' },
			timebase: 'absolute-samples', points: [{ id: `point-${id}`, position: 0, value: .5 }], segments: [] })),
	] }));
	const report = reportInterchangeAudioOmissions(sealDeliveryReport(createDeliveryReport({ format: 'otio' })), project);
	assert.deepEqual(report.items.map(item => [item.scope.id, item.data.automationLanes]), [
		['a', ['bus-mute', 'gain-a']], ['b', ['gain-b']],
	]);
});
