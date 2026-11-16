/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTimelineInterchange } from '../src/common/editor/timeline-interchange-import.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import type { SignatureMap } from '../src/common/editor/musical-grid.ts';
import type { AudioTrackLeaf, AudioClipLeaf } from '../src/common/editor/project-media-types.ts';
import type { AutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { evaluateAutomationLaneAtFrameV21 } from '../src/common/editor/automation-lane-v21.ts';
import { ardourSession, soundcraftSession } from './helpers/native-daw-import-fixtures.ts';

function read(name: string, text: string) {
	let ordinal = 0;
	const document = parseTimelineInterchange(name, text);
	const plan = buildTimelineInterchangeProject(document, { createStableId: prefix => `${prefix}-${++ordinal}` });
	return { document, plan, project: createSoundscaperProject({ ...plan.project, mixer: plan.production.mixer }) };
}

test('SoundCraft imports gain/pan/mute/send curves, clip envelopes, buses and opaque effect state', () => {
	const fixture = soundcraftSession();
	const session = { ...fixture, busses: [{ id: 80, name: 'Reverb', format: 'Stereo' }], tracks: fixture.tracks.map(track => ({ ...track,
		mixer: { ...track.mixer, sends: [{ target: { Bus: 80 }, level_db: -6, active: true }], inserts: [{ plugin: 'clap:org.example.echo', state: 'AQID', params: { mix: .3 }, active: true, bypass: false }] },
		automation: [{ param: 'Volume', enabled: true, points: [{ at: 0, value: -20 }, { at: 48000, value: 0 }] },
			{ param: { Pan: 0 }, enabled: true, points: [{ at: 0, value: -.5 }, { at: 48000, value: .5 }] },
			{ param: 'Mute', enabled: true, points: [{ at: 0, value: 0 }, { at: 48000, value: 1 }] },
			{ param: { SendLevel: 0 }, enabled: true, points: [{ at: 0, value: -20 }, { at: 48000, value: 0 }] }],
		playlists: track.playlists.map(list => ({ ...list, clips: list.clips.map(clip => ({ ...clip, gain_env: [[0, -20], [24000, 0]] })) })),
	})) };
	const { project } = read('Mix.scraft', JSON.stringify(session));
	assert.equal(project.mixer.groups[0]?.name, 'Reverb');
	assert.equal(project.mixer.edges.filter(edge => edge.kind === 'send').length, 1);
	assert.equal((project.automationLanes as readonly AutomationLaneV21[]).length, 4);
	assert.ok(Math.abs(evaluateAutomationLaneAtFrameV21(project.automationLanes[0]!, 24000, { sampleRate: 48000 })! - 10 ** (-10 / 20)) < 2e-5);
	assert.equal((project.tracks[0] as unknown as AudioTrackLeaf).effects[0]?.type, 'missing');
	assert.match(JSON.stringify((project.tracks[0] as unknown as AudioTrackLeaf).effects[0]), /AQID/u);
	const envelope = (project.clips[0] as unknown as AudioClipLeaf).envelope;
	assert.ok(envelope && envelope.length > 2);
	assert.equal(envelope[0]?.value, .1);
});

test('Ardour imports track gain/pan/mute automation, region envelopes, bus routing and processors', () => {
	const xml = ardourSession().replace('<Processor type="amp"><Controllable name="gaincontrol" value="0.5"/></Processor>',
		'<Processor type="amp"><Controllable name="gaincontrol" value="0.5"/><Automation><AutomationList automation-id="gain" interpolation-style="Linear" state="Play"><events>0 .2\n48000 .8</events></AutomationList></Automation></Processor><Processor id="fx1" type="lv2" name="Echo"><lv2 uri="urn:example:echo"/></Processor><IO direction="Output"><Port name="Dialogue/audio_out 1"><Connection other="Bus/audio_in 1"/></Port></IO>')
		.replace('</Routes>', '<Route id="50" name="Bus" default-type="audio"><Processor type="amp"><Controllable name="gaincontrol" value=".6"/></Processor></Route></Routes>')
		.replace('muted="0"/>', 'muted="0"><Envelope><AutomationList interpolation-style="Linear"><events>0 .1\n24000 1</events></AutomationList></Envelope></Region>');
	const { project } = read('Mix.ardour', xml);
	assert.equal(project.mixer.groups[0]?.name, 'Bus');
	assert.equal((project.automationLanes as readonly AutomationLaneV21[]).length, 1);
	assert.equal(evaluateAutomationLaneAtFrameV21(project.automationLanes[0]!, 24000, { sampleRate: 48000 }), .5);
	assert.equal((project.tracks[0] as unknown as AudioTrackLeaf).effects[0]?.type, 'missing');
	assert.equal((project.clips[0] as unknown as AudioClipLeaf).envelope[0]?.value, .1);
	assert.ok(project.mixer.edges.some(edge => edge.source.kind === 'track' && edge.destination.kind === 'mixer-node'));
});

test('Framescaper retains the same native mix graph and automation during product construction', () => {
	const session = soundcraftSession();
	const track = session.tracks[0]!;
	const authored = { ...session, tracks: [{ ...track, automation: [{ param: 'Volume', enabled: true, points: [{ at: 0, value: -20 }, { at: 48000, value: 0 }] }] }] };
	const { plan } = read('Mix.scraft', JSON.stringify(authored));
	const project = createFramescaperProject(undefined, plan.project);
	assert.equal((project.automationLanes as readonly AutomationLaneV21[]).length, 1);
	assert.deepEqual(project.mixer, plan.production.mixer);
});

test('SoundCraft recovers aux/master strips, marker ranges and stepped tempo metadata', () => {
	const session = soundcraftSession(); const source = session.tracks[0]!;
	const { project } = read('Mix.scraft', JSON.stringify({ ...session,
		busses: [{ id: 80, name: 'Wet input', format: 'Stereo' }],
		tempo: { tempos: [{ tick: 0, bpm: 100 }, { tick: 1920, bpm: 140 }], meters: [{ tick: 0, numerator: 3, denominator: 4 }, { tick: 5760, numerator: 5, denominator: 8 }] },
		markers: [{ name: 'Verse', start: 4800, end: 4800 }, { name: 'Chorus', start: 24000, end: 48000 }],
		tracks: [source, { ...source, id: 21, name: 'Reverb return', kind: 'Aux', playlists: [], mixer: { ...source.mixer, input: { Bus: 80 }, volume_db: -12, solo: false } },
			{ ...source, id: 22, name: 'Master', kind: 'Master', playlists: [], mixer: { ...source.mixer, volume_db: -3, solo: false } }],
	}));
	assert.equal(project.mixer.groups.length, 2);
	assert.ok(project.mixer.groups.some(bus => bus.name === 'Reverb return'));
	assert.ok(Math.abs(project.master.gain - 10 ** (-3 / 20)) < 1e-8);
	assert.deepEqual(project.timelineAnnotations.map(marker => [marker.name, marker.kind]), [['Verse', 'marker'], ['Chorus', 'region']]);
	assert.deepEqual(project.tempoMap.events.map(event => event.bpm.num / event.bpm.den), [100, 140]);
	assert.deepEqual((project.signatureMap as unknown as SignatureMap).events.map(event => [event.bar, event.numerator, event.denominator]), [[0, 3, 4], [2, 5, 8]]);
});

test('SoundCraft folders retain ancestry and a single structural mute gate', () => {
	const session = soundcraftSession(), track = session.tracks[0]!;
	const { project } = read('Folders.scraft', JSON.stringify({ ...session, tracks: [
		{ ...track, folder: 90 }, { ...track, id: 90, kind: 'Folder', name: 'Dialogue folder', playlists: [], mixer: { ...track.mixer, mute: true } },
	] }));
	const folder = project.trackFolders[0]; assert.ok(folder);
	assert.equal(folder.name, 'Dialogue folder'); assert.equal(folder.mute, true);
	assert.equal(project.sequences[0]?.trackNodes.find(node => node.kind === 'track')?.parentFolderId, folder.id);
	assert.equal(project.mixer.groups.find(bus => bus.id === folder.id)?.mute, false);
});
