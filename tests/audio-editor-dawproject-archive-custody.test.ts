/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { createSoundscaperProject, type SoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { dawprojectArchiveCustody } from './helpers/dawproject-archive-custody.ts';
import { MASTER_ROUTES, dawprojectMasterRoute } from './helpers/dawproject-master-route.ts';
import { FOREIGN_ROUTES, dawprojectForeignRoute } from './helpers/dawproject-foreign-route.ts';

const FRAMES = 480;
const CREDIT_TAGS = { originalArtist: 'Original performer', composer: 'Composer & co.', songwriter: 'Song writer',
	producer: 'Producer', arranger: 'Arranger', genre: 'Genre', copyright: '© Reviewed owner', website: 'https://example.test/credits' };

function recording(trackIds: readonly string[] = ['voice'], channelCount = 2) {
	const source = createAudioSource({ id: 'recording', name: 'Recording.wav', sampleRate: 48_000, frameCount: FRAMES, channelCount });
	const project = createSoundscaperProject({ id: crypto.randomUUID(), title: 'Archive custody', sources: [source],
		tracks: trackIds.map((id, index) => createAudioTrack({ id, name: `Voice ${String(index + 1)}`, clipIds: [`clip-${String(index)}`] })),
		clips: trackIds.map((_, index) => createAudioClip({ id: `clip-${String(index)}`, sourceId: source.id,
			sourceDurationFrames: FRAMES, durationFrames: FRAMES })) });
	const pcm = Array.from({ length: channelCount }, (_, channel) => new Float32Array(FRAMES).fill(channel % 2 ? -.125 : .25));
	return { project, source, pcm, channels: new Map([[source.storageKey, pcm]]) };
}

function strip(project: SoundscaperProject, name: string) {
	if (name === '$master') return { endpoint: { kind: 'master' as const }, gain: project.master.gain, mute: project.master.mute };
	const track = project.tracks.find(track => track.name === name);
	if (track) return { endpoint: { kind: 'track' as const, id: track.id }, gain: track.gain, mute: track.mute };
	const node = [...project.mixer.groups, ...project.mixer.sends].find(group => group.name === name);
	assert.ok(node, `Missing reopened strip ${name}`);
	return { endpoint: { kind: 'mixer-node' as const, id: node.id }, gain: node.gain, mute: node.mute };
}

function assignment(project: SoundscaperProject, from: string, to: string) {
	const origin = strip(project, from).endpoint;
	const edges = project.mixer.edges.filter(edge => edge.kind === 'assignment' && edge.enabled
		&& isDeepStrictEqual(edge.source, origin));
	assert.equal(edges.length, 1, `${from} has exactly one reopened dry assignment`);
	assert.deepEqual(edges[0]?.destination, strip(project, to).endpoint, `${from} must reach ${to} after reopen`);
	assert.equal(edges[0]?.level, 1);
	assert.equal(edges[0]?.position, 'post-fader');
	assert.deepEqual(edges[0]?.channelMap, [0, 1]);
}

function unprocessedStereo(project: SoundscaperProject, frames: number) {
	assert.equal(project.sources.length, 1);
	assert.equal(project.sampleRate, 48_000);
	for (const source of project.sources) assert.deepEqual([source.sampleRate, source.frameCount, source.channelCount], [48_000, frames, 2]);
	for (const clip of project.clips) {
		assert.deepEqual([clip.timelineStartFrame, clip.sourceStartFrame, clip.sourceDurationFrames, clip.durationFrames,
			clip.speedRatio, clip.gain, clip.reversed, clip.inverted, clip.fadeInFrames, clip.fadeOutFrames],
		[0, 0, frames, frames, 1, 1, false, false, 0, 0]);
		assert.deepEqual(clip.envelope, []);
	}
	for (const item of [project.master, ...project.tracks, ...project.mixer.groups, ...project.mixer.sends]) {
		assert.equal(item.pan, 0); assert.equal(item.solo, false);
		assert.equal(item.mute, 'name' in item && item.name === 'Unassigned outputs');
		assert.equal(item.effectsActive, true); assert.deepEqual(item.effects, []);
	}
}

for (const ids of [['master'], ['voice', 'voice:volume'], ['voice', 'voice:pan', 'voice:mute'], ['ordinary']] as const) {
	test(`DAWproject service and portable reopen retain every source occurrence for ${ids.join(',')}`, async () => {
		const fixture = recording(ids);
		const result = await dawprojectArchiveCustody(fixture.project, fixture.channels);
		unprocessedStereo(result.project, fixture.pcm[0]!.length);
		assert.deepEqual(result.document.tracks.filter(track => track.channel?.role === 'regular').map(track => track.name),
			ids.map((_, index) => `Voice ${String(index + 1)}`));
		assert.equal(result.project.clips.length, ids.length);
		assert.deepEqual(result.project.tracks.filter(track => track.type === 'audio').map(track => track.name),
			ids.map((_, index) => `Voice ${String(index + 1)}`));
		assert.deepEqual([...result.pcm.values()], [fixture.pcm.map(channel => Array.from(channel))]);
	});
}

for (const uppercase of [false, true]) for (const comments of [' Ordinary comment ', '\n  Opening: retain the breath.\n\tEnding: let it ring.\n']) {
	test(`DAWproject metadata crosses export, import and portable reopen: uppercase=${String(uppercase)}, comment=${JSON.stringify(comments)}`, async () => {
		const fixture = recording();
		const tags = Object.fromEntries(Object.entries(CREDIT_TAGS).map(([key, value]) => [uppercase ? key.toUpperCase() : key, value]));
		const project = createSoundscaperProject({ ...fixture.project, metadata: { title: 'Credits', artist: 'Performer', album: 'Album',
			year: '2026', comments, tags } });
		const result = await dawprojectArchiveCustody(project, fixture.channels);
		unprocessedStereo(result.project, fixture.pcm[0]!.length);
		assert.equal(result.document.metadata.comment, comments);
		assert.deepEqual(result.project.metadata.tags, CREDIT_TAGS);
		assert.deepEqual([result.project.metadata.title, result.project.metadata.artist, result.project.metadata.album,
			result.project.metadata.year, result.project.metadata.comments], ['Credits', 'Performer', 'Album', '2026', comments]);
		assert.deepEqual([...result.pcm.values()], [fixture.pcm.map(channel => Array.from(channel))]);
	});
}

for (const sender of ['track', 'bus'] as const) for (const mode of ['master', 'bypass', 'secondary', 'send-only', 'parallel-sends'] as const) {
	test(`DAWproject ${sender} ${mode} routing crosses real archives without changing PCM`, async () => {
		const fixture = recording();
		const base = fixture.project;
		const terminal = base.mixer.outputs.find(output => output.role === 'main'); assert.ok(terminal);
		const bus = { id: 'bus', name: 'Dry bus', color: '#456789', gain: 1, pan: 0, mute: false, solo: false,
			collapsed: false, effectsActive: true, effects: [], channelCount: 2 };
		const wet = { ...bus, id: 'wet', name: 'Wet return' };
		const origin = sender === 'bus' ? { kind: 'mixer-node' as const, id: bus.id } : { kind: 'track' as const, id: 'voice' };
		const destination = mode === 'secondary' ? { kind: 'output' as const, id: 'cue' }
			: mode === 'bypass' ? { kind: 'output' as const, id: terminal.id } : { kind: 'master' as const };
		const project = createSoundscaperProject({ ...base, master: { ...base.master, gain: .2 }, mixer: { ...base.mixer,
			groups: sender === 'bus' ? [bus] : [], sends: mode === 'send-only' || mode === 'parallel-sends' ? [wet] : [],
			outputs: [...base.mixer.outputs, ...(mode === 'secondary' ? [{ id: 'cue', name: 'Cue', role: 'cue', channelCount: 2 }] : [])],
			edges: [
				...base.mixer.edges.flatMap(edge => edge.source.kind !== 'track' ? [edge]
					: sender === 'bus' ? [{ ...edge, destination: { kind: 'mixer-node' as const, id: bus.id } }]
						: mode === 'send-only' ? [] : [{ ...edge, destination }]),
				...(sender === 'bus' && mode !== 'send-only' ? [{ id: 'bus-dry', kind: 'assignment', source: origin, destination,
					position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] }] : []),
				...(mode === 'parallel-sends' ? [{ id: 'send-pre', kind: 'send', source: origin,
					destination: { kind: 'mixer-node', id: wet.id }, position: 'pre-fader', level: .2, enabled: true, channelMap: [0, 1] }] : []),
				...(mode === 'send-only' || mode === 'parallel-sends' ? [
					{ id: 'send-post', kind: 'send', source: origin, destination: { kind: 'mixer-node', id: wet.id },
						position: 'post-fader', level: .3, enabled: true, channelMap: [0, 1] },
					{ id: 'wet-main', kind: 'assignment', source: { kind: 'mixer-node', id: wet.id }, destination: { kind: 'master' },
						position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] },
				] : []),
			],
		} });
		const result = await dawprojectArchiveCustody(project, fixture.channels);
		unprocessedStereo(result.project, fixture.pcm[0]!.length);
		const channel = result.document.tracks.find(track => track.name === (sender === 'bus' ? 'Dry bus' : 'Voice 1'))?.channel;
		assert.ok(channel);
		const target = result.document.tracks.find(track => track.channel?.id === channel.destination)?.channel;
		assert.ok(target);
		assert.equal(target.volume?.value, mode === 'bypass' || mode === 'secondary' ? 1 : mode === 'send-only' ? 1 : .2);
		assert.equal(target.mute?.value === true, mode === 'secondary' || mode === 'send-only');
		assert.deepEqual(channel.sends.map(send => [send.type, send.volume?.value]), mode === 'parallel-sends' ? [['pre', .2], ['post', .3]]
			: mode === 'send-only' ? [['post', .3]] : []);
		const reopened = result.project;
		assert.equal(reopened.master.gain, mode === 'bypass' ? 1 : .2);
		assert.equal(strip(reopened, 'Voice 1').gain, 1);
		if (sender === 'bus') { assignment(reopened, 'Voice 1', 'Dry bus'); assert.equal(strip(reopened, 'Dry bus').gain, 1); }
		const originName = sender === 'bus' ? 'Dry bus' : 'Voice 1';
		assignment(reopened, originName, mode === 'secondary' || mode === 'send-only' ? 'Unassigned outputs' : '$master');
		if (mode === 'secondary' || mode === 'send-only') {
			assert.equal(strip(reopened, 'Unassigned outputs').mute, true);
			assignment(reopened, 'Unassigned outputs', '$master');
		}
		if (mode === 'send-only' || mode === 'parallel-sends') {
			assert.equal(strip(reopened, 'Wet return').gain, 1); assignment(reopened, 'Wet return', '$master');
		}
		const originStrip = sender === 'bus' ? reopened.mixer.groups.find(group => group.name === 'Dry bus')
			: reopened.tracks.find(track => track.name === 'Voice 1'); assert.ok(originStrip);
		assert.deepEqual(reopened.mixer.edges.filter(edge => edge.kind === 'send' && edge.source.kind !== 'master'
			&& edge.source.id === originStrip.id).map(edge => [edge.position, edge.level, edge.destination, edge.channelMap]), mode === 'parallel-sends' ? [['pre-fader', .2, strip(reopened, 'Wet return').endpoint, [0, 1]], ['post-fader', .3, strip(reopened, 'Wet return').endpoint, [0, 1]]]
			: mode === 'send-only' ? [['post-fader', .3, strip(reopened, 'Wet return').endpoint, [0, 1]]] : []);
		assert.deepEqual([...result.pcm.values()], [fixture.pcm.map(values => Array.from(values))]);
	});
}

for (const route of MASTER_ROUTES) test(`DAWproject Master route custody: ${route}`, async () => {
	const fixture = dawprojectMasterRoute(route);
	const result = await dawprojectArchiveCustody(fixture.project, fixture.channels);
	unprocessedStereo(result.project, fixture.pcm[0]!.length);
	const master = result.document.tracks.find(track => track.name === 'Master')?.channel;
	const voice = result.document.tracks.find(track => track.name === 'Voice')?.channel;
	const terminal = result.document.tracks.find(track => track.channel?.role === 'master')?.channel;
	assert.ok(master && voice && terminal);
	assert.equal(master.volume?.value, .2);
	assert.equal(terminal.volume?.value, ['ordinary Master processing', 'secondary output'].includes(route) ? .2 : 1);
	const muted = route.includes('secondary output') || route === 'absent Master output' || route === 'disabled Master output';
	const sink = result.document.tracks.find(track => track.name === 'Unassigned outputs')?.channel;
	assert.equal(Boolean(sink), muted);
	if (sink) {
		assert.equal(sink.mute?.value, true);
		assert.equal(sink.destination, terminal.id);
		assert.equal(route === 'secondary output' ? voice.destination : master.destination, sink.id);
		assert.equal(result.project.mixer.groups.find(group => group.name === 'Unassigned outputs')?.mute, true);
	}
	if (route.includes('coexisting')) {
		const ordinary = result.document.tracks.find(track => track.name === 'Ordinary')?.channel;
		assert.equal(ordinary?.destination, master.id);
		assert.equal(ordinary.volume?.value, .4);
		assert.equal(voice.destination, terminal.id);
		assert.equal(master.destination, terminal.id);
	}
	if (route === 'bus bypass') {
		const bus = result.document.tracks.find(track => track.name === 'Dry bus')?.channel;
		assert.equal(voice.destination, bus?.id);
		assert.equal(bus?.destination, terminal.id);
	} else if (route === 'direct output bypass') assert.equal(voice.destination, terminal.id);
	else if (!route.includes('coexisting') && route !== 'secondary output') assert.equal(voice.destination, master.id);
	const gainLanes = result.project.automationLanes.filter(lane => lane.address.kind === 'strip' && lane.address.parameterId === 'gain');
	assert.equal(gainLanes.length, route === 'automated coexisting paths' ? 1 : 0);
	assert.equal(result.project.automationLanes.length, gainLanes.length);
	if (route === 'automated coexisting paths') {
		const reopenedMaster = result.project.mixer.groups.find(group => group.name === 'Master'); assert.ok(reopenedMaster);
		assert.deepEqual(gainLanes[0]?.address, { kind: 'strip', strip: { kind: 'mixer-node', id: reopenedMaster.id }, parameterId: 'gain' });
		assert.deepEqual(gainLanes[0]?.points.map(point => [point.position, point.value]), [[0, .4]]);
	}
	assert.deepEqual(voice.sends.map(send => [send.type, send.volume?.value]),
		route === 'absent Master output' || route === 'disabled Master output' ? [['post', .4]] : []);
	const reopened = result.project;
	assert.equal(reopened.master.gain, ['ordinary Master processing', 'secondary output'].includes(route) ? .2 : 1);
	assert.equal(strip(reopened, 'Voice').gain, 1);
	const converted = !['ordinary Master processing', 'secondary output'].includes(route);
	if (converted) {
		assert.equal(strip(reopened, 'Master').gain, route === 'automated coexisting paths' ? 1 : .2);
		assignment(reopened, 'Master', muted ? 'Unassigned outputs' : '$master');
	}
	assignment(reopened, 'Voice', route === 'bus bypass' ? 'Dry bus' : route === 'secondary output' ? 'Unassigned outputs'
		: route.includes('coexisting') || route === 'direct output bypass' || route === 'ordinary Master processing' ? '$master' : 'Master');
	if (route === 'bus bypass') { assignment(reopened, 'Dry bus', '$master'); assert.equal(strip(reopened, 'Dry bus').gain, 1); }
	if (route.includes('coexisting')) { assignment(reopened, 'Ordinary', 'Master'); assert.equal(strip(reopened, 'Ordinary').gain, .4); }
	if (route === 'Master secondary output') assignment(reopened, 'Empty bypass', '$master');
	if (muted) assignment(reopened, 'Unassigned outputs', '$master');
	if (route === 'absent Master output' || route === 'disabled Master output') {
		assignment(reopened, 'Dry bus', '$master'); assert.equal(strip(reopened, 'Dry bus').gain, 1);
		const origin = strip(reopened, 'Voice').endpoint;
		assert.deepEqual(reopened.mixer.edges.filter(edge => edge.kind === 'send' && isDeepStrictEqual(edge.source, origin))
			.map(edge => ({ to: edge.destination, level: edge.level, position: edge.position, channelMap: edge.channelMap })),
		[{ to: strip(reopened, 'Dry bus').endpoint, level: .4, position: 'post-fader', channelMap: [0, 1] }]);
	}
	assert.deepEqual([...result.pcm.values()], [fixture.pcm.map(channel => Array.from(channel))]);
});

for (const automated of [false, true]) for (const route of FOREIGN_ROUTES) {
	test(`DAWproject foreign route custody: ${route}, automated=${String(automated)}`, async () => {
		const fixture = dawprojectForeignRoute(route, automated);
		const result = await dawprojectArchiveCustody(fixture.project, fixture.channels);
		unprocessedStereo(result.project, fixture.pcm[0]!.length);
		const names = result.document.tracks.map(track => track.name);
		assert.equal(names.includes('Other sequence recording'), false);
		assert.equal(names.includes('Foreign bus'), route.startsWith('foreign'));
		assert.equal(names.includes('Parent bus'), route === 'foreign-chain');
		const ids = new Set(result.document.tracks.map(track => track.channel?.id));
		assert.ok(result.document.tracks.every(track => !track.channel?.destination || ids.has(track.channel.destination)));
		const voice = result.document.tracks.find(track => track.name === 'Voice')?.channel;
		const busName = route === 'ordinary-submix' ? 'Ordinary bus' : 'Foreign bus';
		const bus = result.document.tracks.find(track => track.name === busName)?.channel; assert.ok(bus);
		assert.equal(voice?.destination, bus.id);
		assert.equal(bus.volume?.value, .4);
		const master = result.document.tracks.find(track => track.name === 'Master')?.channel;
		const parent = result.document.tracks.find(track => track.name === 'Parent bus')?.channel;
		assert.equal(bus.destination, route === 'foreign-chain' ? parent?.id : master?.id);
		assert.equal(result.project.clips.length, 1);
		const reopenedBus = result.project.mixer.groups.find(group => group.name === busName); assert.ok(reopenedBus);
		assert.equal(result.project.master.gain, 1);
		assert.equal(reopenedBus.gain, automated ? 1 : .4);
		assert.equal(strip(result.project, 'Voice').gain, 1);
		assignment(result.project, 'Voice', busName);
		assignment(result.project, busName, route === 'foreign-chain' ? 'Parent bus' : '$master');
		if (route === 'foreign-chain') {
			assert.equal(strip(result.project, 'Parent bus').gain, .4);
			assert.equal(strip(result.project, 'Parent bus').mute, false);
			assignment(result.project, 'Parent bus', '$master');
		}
		assert.equal(reopenedBus.mute, false, 'foreign sequence folder mute must not silence the retained audible bus');
		assert.equal(result.project.automationLanes.length, automated ? 1 : 0);
		if (automated) {
			assert.deepEqual(result.project.automationLanes[0]?.address,
				{ kind: 'strip', strip: { kind: 'mixer-node', id: reopenedBus.id }, parameterId: 'gain' });
			assert.deepEqual(result.project.automationLanes[0]?.points.map(point => [point.position, point.value]), [[0, .2]]);
		}
		assert.deepEqual([...result.pcm.values()], [fixture.pcm.map(channel => Array.from(channel))]);
	});
}
