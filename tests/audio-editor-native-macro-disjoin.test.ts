/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { findClipSilenceRegions } from '../src/common/editor/clip-silence-regions.ts';
import { clipLoopUpdateFields } from '../src/common/editor/audio-clip-loop.ts';
import { createClipboardEditService } from '../src/common/editor/controller/edit/internal/clipboard-edit-service.ts';
import { createMacroCommandService } from '../src/common/editor/controller/effects/internal/macro/macro-command-service.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createMacroCommandStep } from '../src/common/editor/macro-command-steps.ts';
import { parseAudacityShortcutImport } from '../src/common/editor/audacity-shortcut-import.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';

for (const level of [.0005, -.0005, .001]) test(`native Disjoin retains nonzero samples at ${level}`, () => {
	const fixture = recording(level);
	assert.deepEqual(findClipSilenceRegions(fixture.clip, fixture.buffer, null, null, { absoluteSilence: true }), []);
});

for (const native of [false, true]) test(`absolute-zero silence detaches with native=${native}`, () => {
	const fixture = recording(0);
	assert.deepEqual(findClipSilenceRegions(fixture.clip, fixture.buffer, null, null, { absoluteSilence: native }), [[12_000, 36_000]]);
});

test('ordinary local Disjoin keeps its deliberate near-silence classifier', () => {
	const fixture = recording(.0005);
	assert.deepEqual(findClipSilenceRegions(fixture.clip, fixture.buffer), [[12_000, 36_000]]);
});

for (const length of [479, 480, 481]) test(`native exact-zero minimum remains ten milliseconds: ${length} samples`, () => {
	const fixture = recording(0, 1, length);
	assert.deepEqual(findClipSilenceRegions(fixture.clip, fixture.buffer, null, null, { absoluteSilence: true }),
		length < 480 ? [] : [[12_000, 12_000 + length]]);
});

test('one nonzero stereo channel protects a passage while its other channel is zero', () => {
	const fixture = recording(.0005, 2);
	assert.deepEqual(findClipSilenceRegions(fixture.clip, fixture.buffer, null, null, { absoluteSilence: true }), []);
});

test('native detection retains exact selected timeline boundaries', () => {
	const fixture = recording(0);
	assert.deepEqual(findClipSilenceRegions(fixture.clip, fixture.buffer, { startFrame: 18_000, endFrame: 30_000 }, null,
		{ absoluteSilence: true }), [[18_000, 30_000]]);
});

for (const mode of ['reversed', 'warped', 'looped'] as const) test(`native classification survives ${mode} source projection`, () => {
	const fixture = recording(.0005);
	const clip = { ...fixture.clip, kind: 'audio' as const,
		...(mode === 'reversed' ? { reversed: true } : {}),
		...(mode === 'warped' ? { warpMap: { feature: 'audio-warp', points: [
			{ outer: 0, source: 0, mode: 'forward' }, { outer: 48_000, source: 48_000, mode: 'forward' },
		] } } : {}),
	};
	const projected = mode === 'looped' ? { ...clip, ...clipLoopUpdateFields(clip, { periodFrames: 48_000, durationFrames: 96_000 }) } : clip;
	assert.deepEqual(findClipSilenceRegions(projected, fixture.buffer, null, { ...fixture.project }, { absoluteSilence: true }), []);
});

for (const native of [false, true]) for (const level of [0, .0005]) {
	test(`actual native macro and clipboard service retain policy with native=${native}, level=${level}`, async () => {
		const fixture = editFixture(level);
		if (native) await fixture.macro.runMacroCommand(createMacroCommandStep('Disjoin'));
		else await fixture.service.disjoinSelectedClip();
		const detached = !native || level === 0;
		assert.equal(fixture.project().clips.length, detached ? 2 : 1);
		assert.equal(fixture.commits(), detached ? 1 : 0);
		assert.ok(validateSoundscaperProject(fixture.project()));
	});
}

test('legacy Disjoin shortcut declines the local near-silence classifier', () => {
	const plan = parseAudacityShortcutImport('<audacitykeyboard><command name="Disjoin" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>',
		{ disjoin: [] }, { availableActionIds: ['disjoin'] });
	assert.equal(plan.importedCount, 0);
	assert.deepEqual(plan.skipped, [{ command: 'Disjoin', reason: 'unsupported-command' }]);
});

test('modern Disjoin shortcut retains the ordinary local action', () => {
	const plan = parseAudacityShortcutImport('<Shortcuts><SC><key>disjoin</key><seq>Ctrl+Alt+Shift+F7</seq></SC></Shortcuts>',
		{ disjoin: [] }, { availableActionIds: ['disjoin'] });
	assert.equal(plan.importedCount, 1);
	assert.deepEqual(plan.shortcuts.disjoin, ['Ctrl+Alt+Shift+F7']);
});

function recording(level: number, channelCount = 1, silenceLength = 24_000) {
	const channels = Array.from({ length: channelCount }, () => new Float32Array(48_000).fill(.2));
	for (const channel of channels) channel.fill(0, 12_000, 12_000 + silenceLength);
	channels.at(-1)!.fill(level, 12_000, 12_000 + silenceLength);
	const clip = { timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 48_000, durationFrames: 48_000 };
	const source = createAudioSource({ id: 'source', storageKey: 'source', sampleRate: 48_000, channelCount, frameCount: 48_000 });
	const project = createSoundscaperProject({ id: 'native-disjoin', sampleRate: 48_000, sources: [source],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })], clips: [createAudioClip({ id: 'clip', sourceId: source.id, ...clip })],
		selection: { startFrame: 0, endFrame: 48_000, trackIds: ['track'], clipIds: [] },
	});
	assert.ok(validateSoundscaperProject(project));
	return { clip, project, buffer: { sampleRate: 48_000, numberOfChannels: channelCount,
		getChannelData: (channel: number) => channels[channel]! } };
}

function editFixture(level: number) {
	const fixture = recording(level);
	let project = fixture.project, commits = 0, serial = 0;
	const view = () => {
		const current = projectForRuntimeConsumers({ ...project });
		return { ...current, sources: current.sources.map(source => ({ ...source })),
			tracks: current.tracks.map(track => ({ ...track })), clips: current.clips.map(clip => ({ ...clip })) };
	};
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const service = createClipboardEditService({ lifetime,
		state: { selectedTrackId: 'track', selectedClipId: null, clipboard: null }, copy: { noSilencesFound: 'No silences', track: 'Track' },
		session: { setClipboard: descriptor => ({ clipboard: { descriptor, sources: [] } }), clipboardForProject: () => null },
		sourceBuffers: new Map([['source', fixture.buffer]]), getProject: view, editingBlocked: () => false,
		getPositionFrames: () => 0, normalizeFrame: Number, snapFrame: Number, createId: prefix => `${prefix}-${++serial}`, setStatus() {},
		commit: command => { project = applySoundscaperProjectCommand(project, command); commits++; },
	});
	const macro = createMacroCommandService({ getProject: view, getActions: () => ({ edit: { disjoin: service.disjoinSelectedClip } }),
		projectSampleRate: () => 48_000, timelineDurationFrames: () => 48_000, setExactSelection() {},
	});
	return { service, macro, project: () => project, commits: () => commits };
}
