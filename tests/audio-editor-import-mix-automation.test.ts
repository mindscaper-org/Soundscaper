/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDawprojectDocument } from '../src/common/editor/dawproject-import.ts';
import { buildDawprojectProject } from '../src/common/editor/dawproject-import-project.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { evaluateAutomationLaneAtFrameV21 } from '../src/common/editor/automation-lane-v21.ts';
import type { AudioTrackLeaf } from '../src/common/editor/project-media-types.ts';
import type { AutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';

function imported(points: string, controls = '<Volume id="v" value=".7" unit="linear"/><Pan id="p" value=".5"/><Mute id="m" value="false"/>') {
	let ordinal = 0;
	const document = parseDawprojectDocument(`<Project version="1.0"><Structure><Track id="t" name="Voice" contentType="audio"><Channel id="c" role="regular">${controls}</Channel></Track></Structure><Arrangement><Lanes timeUnit="seconds">${points}</Lanes></Arrangement></Project>`);
	const plan = buildDawprojectProject(document, { sampleRate: 8000, media: new Map(), createStableId: prefix => `${prefix}-${++ordinal}` });
	return { plan, project: importSoundscaperAudacityProject(createCurrentAudioEditorProject(plan.project), plan.routingContext) };
}

test('DAWproject preserves held gain, pan and mute as editable absolute automation lanes', () => {
	const { project, plan } = imported('<Points unit="linear"><Target parameter="v"/><RealPoint time="0" value=".2" interpolation="hold"/><RealPoint time="1" value=".8"/></Points><Points><Target parameter="p"/><RealPoint time="0" value="0" interpolation="linear"/><RealPoint time="1" value="1"/></Points><Points><Target parameter="m"/><BoolPoint time="0" value="false"/><BoolPoint time="1" value="true"/></Points>');
	assert.equal(project.automationLanes.length, 3);
	const values = project.automationLanes.map(lane => evaluateAutomationLaneAtFrameV21(lane, 4000, { sampleRate: 8000 }));
	assert.deepEqual(values, [.2, 0, 0]);
	assert.equal(project.automationLanes[0]?.segments[0]?.kind, 'hold');
	assert.equal(project.automationLanes[2]?.segments[0]?.kind, 'hold');
	const framescaper = createFramescaperProject(undefined, plan.project);
	assert.equal((framescaper.automationLanes as readonly AutomationLaneV21[]).length, 3);
	assert.ok(!plan.report.items.some(item => /automation.*(?:omitted|hold-converted)/u.test(item.code)));
});

test('DAWproject dB curves retain their declared-unit interpolation and resolve duplicate sample anchors', () => {
	const { project } = imported('<Points unit="decibel"><Target parameter="v"/><RealPoint time="0" value="-40" interpolation="linear"/><RealPoint time="1" value="0"/><RealPoint time="1" value="-6"/></Points>');
	const lane = project.automationLanes[0]!;
	assert.ok(Math.abs(evaluateAutomationLaneAtFrameV21(lane, 4000, { sampleRate: 8000 })! - 10 ** (-23 / 20)) < 1e-5);
	assert.equal(evaluateAutomationLaneAtFrameV21(lane, 8000, { sampleRate: 8000 }), 10 ** (-6 / 20));
});

test('DAWproject retains an explicit negative-infinity dB silence without nonfinite project values', () => {
	const { project } = imported('<Points unit="decibel"><Target parameter="v"/><RealPoint time="0" value="-INF" interpolation="hold"/><RealPoint time="1" value="-6"/></Points>');
	assert.equal(evaluateAutomationLaneAtFrameV21(project.automationLanes[0]!, 4000, { sampleRate: 8000 }), 0);
	assert.equal(project.automationLanes[0]?.segments[0]?.kind, 'hold');
});

test('DAWproject imports generic realtime EQ/dynamics and resolves their parameter automation', () => {
	const { project, plan } = imported('<Points unit="decibel"><Target parameter="threshold"/><RealPoint time="0" value="-40" interpolation="linear"/><RealPoint time="1" value="-10"/></Points>',
		'<Devices><Equalizer id="eq" deviceName="EQ" deviceRole="audioFX"><Band type="bell"><Freq id="freq" unit="hertz" value="200"/><Gain unit="decibel" value="3"/><Q value="1"/></Band></Equalizer><Compressor deviceName="Comp" deviceRole="audioFX"><Threshold id="threshold" value="-18" unit="decibel"/><Ratio value="4" unit="linear"/><Attack value=".01" unit="seconds"/><Release value=".2" unit="seconds"/></Compressor><NoiseGate deviceName="Gate" deviceRole="audioFX"><Threshold value="-40" unit="decibel"/></NoiseGate><Limiter deviceName="Limit" deviceRole="audioFX"><Threshold value="-1" unit="decibel"/></Limiter></Devices>');
	assert.deepEqual((project.tracks[0] as unknown as AudioTrackLeaf).effects.map(effect => effect.type), ['eq', 'compressor', 'gate', 'limiter']);
	assert.equal(project.automationLanes.length, 1);
	assert.equal(project.automationLanes[0]?.address.kind, 'effect');
	assert.equal(evaluateAutomationLaneAtFrameV21(project.automationLanes[0]!, 4000, { sampleRate: 8000 }), -25);
	assert.ok(plan.report.items.some(item => item.code === 'dawproject.device-converted'));
});

test('DAWproject retains unknown plugin identities, bypass, original parameters and automation', () => {
	const { project } = imported('<Points><Target parameter="mix"/><RealPoint time="0" value=".3"/></Points>',
		'<Devices><ClapPlugin id="fx" deviceID="org.example.echo" deviceName="Echo" deviceRole="audioFX"><Parameters><RealParameter id="mix" parameterID="23" value=".5"/></Parameters><Enabled value="false"/><State path="plugins/echo.clap-preset"/></ClapPlugin></Devices>');
	const effect = (project.tracks[0] as unknown as AudioTrackLeaf).effects[0];
	assert.equal(effect?.type, 'missing'); assert.equal(effect?.enabled, false); assert.equal(effect?.bypassed, true);
	assert.match(JSON.stringify(effect), /org.example.echo/u);
	assert.match(JSON.stringify(effect), /RealPoint/u);
});

test('DAWproject send automation retains the individual pre-fader connection address', () => {
	let ordinal = 0;
	const document = parseDawprojectDocument('<Project version="1.0"><Structure><Track id="voice" name="Voice" contentType="audio"><Channel id="c"><Sends><Send destination="wet" type="pre"><Volume id="send-level" value=".5" unit="linear"/></Send></Sends></Channel></Track><Track id="aux" name="Reverb"><Channel id="wet" role="effect"/></Track></Structure><Arrangement><Lanes timeUnit="seconds"><Points unit="linear"><Target parameter="send-level"/><RealPoint time="0" value=".1" interpolation="hold"/><RealPoint time="1" value=".8"/></Points></Lanes></Arrangement></Project>');
	const plan = buildDawprojectProject(document, { sampleRate: 8000, media: new Map(), createStableId: prefix => `${prefix}-${++ordinal}` });
	const project = importSoundscaperAudacityProject(createCurrentAudioEditorProject(plan.project), plan.routingContext);
	const edge = project.mixer.edges.find(edge => edge.kind === 'send'); assert.ok(edge);
	assert.equal(edge.position, 'pre-fader');
	assert.deepEqual(project.automationLanes[0]?.address, { kind: 'edge', edgeId: edge.id, parameterId: 'level' });
	assert.equal(evaluateAutomationLaneAtFrameV21(project.automationLanes[0]!, 4000, { sampleRate: 8000 }), .1);
});

for (const inactive of [false, true]) test(`DAWproject folder mute automation respects inactive=${inactive} without a duplicate gate`, () => {
	let ordinal = 0;
	const document = parseDawprojectDocument(`<Project><Structure><Track id="folder" name="Folder" contentType="tracks" loaded="${!inactive}"><Channel id="bus" role="submix"><Mute id="mute" value="true"/></Channel><Track id="voice" contentType="audio"/></Track></Structure><Arrangement><Lanes timeUnit="seconds"><Points><Target parameter="mute"/><BoolPoint time="0" value="false"/><BoolPoint time="1" value="true"/></Points></Lanes></Arrangement></Project>`);
	const plan = buildDawprojectProject(document, { media: new Map(), createStableId: prefix => `${prefix}-${++ordinal}` });
	const project = importSoundscaperAudacityProject(createCurrentAudioEditorProject(plan.project), plan.routingContext);
	assert.equal(project.trackFolders[0]?.mute, inactive);
	assert.equal(project.automationLanes.length, inactive ? 0 : 1);
});
