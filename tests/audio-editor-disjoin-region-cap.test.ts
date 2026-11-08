/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { findClipSilenceRegions } from '../src/common/editor/clip-silence-regions.ts';
import { createClipboardEditService } from '../src/common/editor/controller/edit/internal/clipboard-edit-service.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { localizedErrorMessage } from '../src/common/i18n/presentation-message.ts';

for (const pauses of [127, 128]) test(`all ${pauses} admitted silence regions remain supported`, () => {
	const fixture = recording(pauses);
	const regions = findClipSilenceRegions(fixture.clip, fixture.buffer);
	assert.equal(regions.length, pauses);
	assert.deepEqual(regions.at(-1), [960 + (pauses - 1) * 1920, pauses * 1920]);
});

test('a 129th selected internal silence refuses instead of returning partial success', () => {
	const fixture = recording(129);
	assert.throws(() => findClipSilenceRegions(fixture.clip, fixture.buffer), capacityError);
});

test('native exact-zero policy retains the same region capacity', () => {
	const fixture = recording(129);
	assert.throws(() => findClipSilenceRegions(fixture.clip, fixture.buffer, null, null, { absoluteSilence: true }), capacityError);
});

test('a larger source remains supported when the selected scope contains only 128 pauses', () => {
	const fixture = recording(129);
	const regions = findClipSilenceRegions(fixture.clip, fixture.buffer, { startFrame: 0, endFrame: 128 * 1920 });
	assert.equal(regions.length, 128);
	assert.deepEqual(regions.at(-1), [244_800, 245_760]);
});

test('silence touching the clip edge does not consume an internal region slot', () => {
	const fixture = recording(128);
	fixture.samples.fill(0, fixture.samples.length - 480);
	assert.equal(findClipSilenceRegions(fixture.clip, fixture.buffer).length, 128);
});

test('capacity refusal stops at 129 without scanning unrelated trailing material', () => {
	const fixture = recording(129, 480_000);
	let reads = 0;
	const samples = new Proxy(fixture.samples, { get(target, key) {
		if (typeof key === 'string' && /^\d+$/u.test(key)) reads++;
		return Reflect.get(target, key, target);
	} });
	assert.throws(() => findClipSilenceRegions(fixture.clip, { ...fixture.buffer, getChannelData: () => samples }), capacityError);
	assert.ok(reads <= 129 * 1920 + 1, `${reads} source sample reads`);
});

test('an over-limit second clip cannot partially detach an earlier selected clip', async () => {
	const short = recording(1), long = recording(129);
	const sources = [short, long].map((fixture, index) => createAudioSource({ id: `source-${index}`, storageKey: `source-${index}`,
		sampleRate: 48_000, channelCount: 1, frameCount: fixture.samples.length }));
	let project = createSoundscaperProject({ id: 'atomic-disjoin', sampleRate: 48_000, sources,
		tracks: sources.map((_, index) => createAudioTrack({ id: `track-${index}`, clipIds: [`clip-${index}`] })),
		clips: [short, long].map((fixture, index) => createAudioClip({ id: `clip-${index}`, sourceId: `source-${index}`, ...fixture.clip })),
		selection: { startFrame: 0, endFrame: long.samples.length, trackIds: ['track-0', 'track-1'], clipIds: [] },
	});
	assert.ok(validateSoundscaperProject(project));
	const original = project;
	let commits = 0, serial = 0;
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const service = createClipboardEditService({ lifetime,
		state: { selectedTrackId: 'track-0', selectedClipId: null, clipboard: null }, copy: { noSilencesFound: 'No silences', track: 'Track' },
		session: { setClipboard: descriptor => ({ clipboard: { descriptor, sources: [] } }), clipboardForProject: () => null },
		sourceBuffers: new Map([['source-0', short.buffer], ['source-1', long.buffer]]),
		getProject: () => {
			const current = projectForRuntimeConsumers({ ...project });
			return { ...current, sources: current.sources.map(source => ({ ...source })),
				tracks: current.tracks.map(track => ({ ...track })), clips: current.clips.map(clip => ({ ...clip })) };
		}, editingBlocked: () => false, getPositionFrames: () => 0, normalizeFrame: Number, snapFrame: Number,
		createId: prefix => `${prefix}-${++serial}`, setStatus() {},
		commit: command => { project = applySoundscaperProjectCommand(project, command); commits++; },
	});
	await assert.rejects(service.disjoinSelectedClip(), capacityError);
	assert.equal(commits, 0);
	assert.equal(project, original);
});

function capacityError(error: unknown): boolean {
	assert.ok(error instanceof RangeError);
	assert.equal(error.message, 'More than 128 silent regions were found. Select a smaller range.');
	assert.deepEqual(localizedErrorMessage(error), { key: 'silenceRegionLimit', parameters: { limit: 128 } });
	return true;
}

function recording(pauses: number, tail = 0) {
	const length = pauses * 1920 + 960 + tail;
	const samples = new Float32Array(length).fill(.2);
	for (let index = 0; index < pauses; index++) samples.fill(0, 960 + index * 1920, 1920 + index * 1920);
	const clip = { timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: length, durationFrames: length };
	const source = createAudioSource({ id: 'source', storageKey: 'source', sampleRate: 48_000, channelCount: 1, frameCount: length });
	const project = createSoundscaperProject({ id: 'region-cap', sampleRate: 48_000, sources: [source],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })], clips: [createAudioClip({ id: 'clip', sourceId: source.id, ...clip })] });
	assert.ok(validateSoundscaperProject(project));
	return { clip, samples, buffer: { sampleRate: 48_000, numberOfChannels: 1, getChannelData: () => samples } };
}
