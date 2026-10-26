/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultAdmMetadata } from '../src/common/editor/ui/adm-metadata-editor-model.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createMixRenderSnapshot } from '../src/common/editor/controller/track-audio/mix-render-model.ts';
import { predictIndividualMixRenderOutputChannelCount } from '../src/common/editor/controller/track-audio/mix-render-output-layout.ts';
import { prepareMixRenderOperationCommit } from '../src/common/editor/controller/track-audio/internal/mix-render/mix-render-commit.ts';
import { normalizeMixRenderOptions } from '../src/common/editor/controller/track-audio/mix-render-options.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import type { ControllerProject, ControllerTrack } from '../src/common/editor/controller/track-audio/track-domain-types.ts';

function fixture(width = 2, enabled = true, mixed = false) {
	const sources = [createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 48_000, channelCount: width }),
		...(mixed ? [createAudioSource({ id: 'mono', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 })] : [])];
	const base = createSoundscaperProject({ id: 'print-taps', sources,
		clips: sources.map((source, index) => createAudioClip({ id: source.id, sourceId: source.id, timelineStartFrame: index * 48_000, sourceDurationFrames: 48_000, durationFrames: 48_000 })),
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', gain: .5, pan: -.2, clipIds: sources.map(source => source.id) })] });
	return createSoundscaperProject({ ...base, mixer: { ...base.mixer,
		sends: [{ id: 'aux', name: 'Aux', color: '#456789', channelCount: 2, gain: 1, pan: 0, mute: false, solo: false, collapsed: false, effectsActive: true, effects: [] }],
		edges: [...base.mixer.edges,
			{ id: 'pre', kind: 'send', source: { kind: 'track', id: 'voice' }, destination: { kind: 'mixer-node', id: 'aux' }, position: 'pre-fader', level: .2, enabled, channelMap: width === 1 ? [0, 0] : [0, 1] },
			{ id: 'return', kind: 'assignment', source: { kind: 'mixer-node', id: 'aux' }, destination: { kind: 'master' }, position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] }],
	}, automationLanes: [{ id: 'fader', address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' },
		timebase: 'absolute-samples', points: [{ id: 'point', position: 0, value: .25 }], segments: [] }] });
}
const native = (project: ReturnType<typeof fixture>) => project as unknown as ControllerProject;
const track = (project: ReturnType<typeof fixture>) => project.tracks[0]! as unknown as ControllerTrack;

for (const width of [1, 2, 6]) test(`pre-fader individual print captures ${width} channels before authored strip controls`, () => {
	const project = fixture(width), before = JSON.stringify(project);
	const snapshot = createMixRenderSnapshot(native(project), [track(project)], { mixDown: false, renderEffects: true });
	assert.equal(snapshot.tracks[0]!.gain, 1);
	assert.equal(snapshot.tracks[0]!.pan, 0);
	assert.deepEqual(snapshot.automationLanes, []);
	assert.equal(predictIndividualMixRenderOutputChannelCount(native(project), track(project)), width);
	assert.equal(JSON.stringify(project), before);
});

for (const replaceOriginals of [true, false]) test(`pre-fader print retains strip controls and fader automation with replace=${replaceOriginals}`, () => {
	const project = fixture(); let sequence = 0;
	const prepared = prepareMixRenderOperationCommit(native(project), [{ targetTracks: [track(project)],
		source: createAudioSource({ id: 'printed', sampleRate: 48_000, frameCount: 48_000, channelCount: 2 }), startFrame: 0, name: 'Print' }],
		normalizeMixRenderOptions({ mixDown: false, renderEffects: true, replaceOriginals }), { createId: prefix => `${prefix}-${++sequence}` });
	const applied = applySoundscaperProjectCommand(project, prepared.command);
	const id = prepared.results[0]!.trackId;
	const output = applied.tracks.find(value => value.id === id)!;
	assert.equal(output.gain, .5); assert.equal(output.pan, -.2);
	const lane = applied.automationLanes.find(value => value.address.kind === 'strip' && value.address.strip.kind === 'track' && value.address.strip.id === id);
	assert.ok(lane); assert.deepEqual(lane.points.map(value => value.value), [.25]);
	if (!replaceOriginals) assert.notEqual(lane.id, 'fader');
});

test('disabled pre-fader routes keep existing post-fader individual print semantics', () => {
	const project = fixture(1, false);
	const snapshot = createMixRenderSnapshot(native(project), [track(project)], { mixDown: false });
	assert.equal(snapshot.tracks[0]!.gain, .5);
	assert.equal(predictIndividualMixRenderOutputChannelCount(native(project), track(project)), 2);
});

test('a mixed-width pre-fader print refuses before replacing its dynamic native panner geometry', () => {
	const project = fixture(2, true, true), before = JSON.stringify(project);
	assert.throws(() => createMixRenderSnapshot(native(project), [track(project)], { mixDown: false }), /changing channel widths/u);
	assert.equal(JSON.stringify(project), before);
});

test('pre-fader capture bakes rack automation but preserves only strip lanes on the result', () => {
	const base = fixture();
	const project = createSoundscaperProject({ ...base,
		tracks: base.tracks.map(value => ({ ...value, effects: [{ id: 'filter', type: 'highpass', enabled: true, params: {} }] })),
		automationLanes: [...base.automationLanes, { id: 'frequency', address: { kind: 'effect', strip: { kind: 'track', id: 'voice' }, effectId: 'filter', parameterId: 'frequency' },
			timebase: 'absolute-samples', points: [{ id: 'freq-start', position: 0, value: 1000 }], segments: [] }],
	});
	const snapshot = createMixRenderSnapshot(native(project), [track(project)], { mixDown: false, renderEffects: true });
	assert.deepEqual((snapshot.automationLanes as { id: string }[]).map(lane => lane.id), ['frequency']);
	let sequence = 0;
	const prepared = prepareMixRenderOperationCommit(native(project), [{ targetTracks: [track(project)],
		source: createAudioSource({ id: 'printed', sampleRate: 48_000, frameCount: 48_000, channelCount: 2 }), startFrame: 0, name: 'Print' }],
		normalizeMixRenderOptions({ mixDown: false, renderEffects: true, replaceOriginals: true }), { createId: prefix => `${prefix}-${++sequence}` });
	const applied = applySoundscaperProjectCommand(project, prepared.command);
	assert.deepEqual(applied.automationLanes.map(lane => lane.id), ['fader']);
	assert.deepEqual(applied.tracks[0]!.effects, []);
});

test('an enabled zero-level pre-fader edge with authored level automation still retains both taps', () => {
	const base = fixture();
	const project = createSoundscaperProject({ ...base, mixer: { ...base.mixer,
		edges: base.mixer.edges.map(edge => edge.id === 'pre' ? { ...edge, level: 0 } : edge),
	}, automationLanes: [...base.automationLanes, { id: 'send-level', address: { kind: 'edge', edgeId: 'pre', parameterId: 'level' },
		timebase: 'absolute-samples', points: [{ id: 'send-start', position: 0, value: .2 }], segments: [] }] });
	const snapshot = createMixRenderSnapshot(native(project), [track(project)], { mixDown: false });
	assert.equal(snapshot.tracks[0]!.gain, 1);
});

test('mono stereo-reverb refusal is limited to operative pre-fader processing', () => {
	for (const mode of ['active', 'dry', 'disabled', 'bypassed', 'rack-disabled', 'no-pre'] as const) {
		const base = fixture(1, mode !== 'no-pre');
		const project = createSoundscaperProject({ ...base, tracks: base.tracks.map(value => ({ ...value,
			effectsActive: mode !== 'rack-disabled', effects: [{ id: 'verb', type: 'reverb', enabled: mode !== 'disabled',
				...(mode === 'bypassed' ? { bypassed: true as const } : {}), params: { mix: mode === 'dry' ? 0 : .2 } }],
		})) });
		const capture = () => createMixRenderSnapshot(native(project), [track(project)], { mixDown: false });
		if (mode === 'active') assert.throws(capture, /mono track with stereo reverb/u);
		else assert.doesNotThrow(capture);
	}
});

test('mono pre-fader capture respects the suspended pan policy of authored ADM', () => {
	const base = fixture(1);
	const project = createSoundscaperProject({ ...base, metadata: { ...base.metadata, adm: createDefaultAdmMetadata(base, 'stereo') } });
	const snapshot = createMixRenderSnapshot(native(project), [track(project)], { mixDown: false });
	assert.equal(snapshot.masterChannels, 1);
	assert.equal(snapshot.tracks[0]!.gain, 1);
	assert.equal(snapshot.metadata && (snapshot.metadata as { adm: unknown }).adm, null);
});
