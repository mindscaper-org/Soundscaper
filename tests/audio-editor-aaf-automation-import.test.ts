/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { withAafReference } from './helpers/aaf-reference.ts';
import { parseAafDocument } from '../src/common/editor/aaf-import.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';
import type { AudioClipLeaf } from '../src/common/editor/project-media-types.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { evaluateAutomationLaneAtFrameV21 } from '../src/common/editor/automation-lane-v21.ts';

function fixture(scenario: 'gain' | 'pan' | 'dissolve' | 'constant' | 'held' | 'two' | 'nested-pan' | 'nonlinear-gain' | 'mixed-clock-gain') {
	return withAafReference(`
import os, wave
from aaf2.rational import AAFRational
with aaf2.open(sys.argv[1], 'w', extensions=False) as f:
    wav = os.path.join(os.path.dirname(sys.argv[1]), 'Voice.wav')
    with wave.open(wav, 'wb') as w:
        w.setparams((1, 2, 48000, 96000, 'NONE', 'not compressed'))
        w.writeframes(b'\\x00\\x20' * 96000)
    master = f.create.MasterMob('Voice'); f.content.mobs.append(master); master.import_audio_essence(wav)
    composition = f.create.CompositionMob('Automated mix'); f.content.mobs.append(composition)
    scenario = ${JSON.stringify(scenario)}
    if scenario == 'mixed-clock-gain':
        clock = composition.create_timeline_slot(48000); clock.name = 'Clock'; clock.segment = f.create.Filler('sound', 48)
    slot = composition.create_timeline_slot(44100 if scenario == 'mixed-clock-gain' else 48000); slot.name = 'Dialogue'
    definitions = {'gain': ('9d2ea894-0968-11d3-8a38-0050040ef7d2', 'MonoAudioGain', 'e4962321-2267-11d3-8a4c-0050040ef7d2', 'Amplitude'),
      'pan': ('9d2ea893-0968-11d3-8a38-0050040ef7d2', 'MonoAudioPan', 'e4962322-2267-11d3-8a4c-0050040ef7d2', 'Pan'),
      'two': ('2311bd90-b5da-4285-aa3a-8552848779b3', 'TwoParameterMonoAudioDissolve', '9e610007-1be2-41e1-bb11-c95de9964d03', 'OutgoingLevel'),
      'dissolve': ('0c3bea41-fc05-11d2-8a29-0050040ef7d2', 'MonoAudioDissolve', 'e4962320-2267-11d3-8a4c-0050040ef7d2', 'Level')}
    kind = 'gain' if scenario in ['constant', 'held', 'nonlinear-gain', 'mixed-clock-gain'] else ('pan' if scenario == 'nested-pan' else scenario)
    opid, opname, paramid, paramname = definitions[kind]
    op = f.create.OperationDef(opid, opname); op.media_kind = 'sound'; op.number_inputs = 2 if scenario in ['dissolve', 'two'] else 1
    param = f.create.ParameterDef(paramid, paramname, typedef='Rational'); f.dictionary.register_def(param)
    interp = f.create.InterpolationDef('5b6c85a5-0ede-11d3-80a9-006008143e6f' if scenario == 'held' else '5b6c85a4-0ede-11d3-80a9-006008143e6f', 'Constant' if scenario == 'held' else 'Linear'); f.dictionary.register_def(interp)
    if scenario == 'nonlinear-gain':
        interp = f.create.InterpolationDef('5b6c85a6-0ede-11d3-80a9-006008143e6f', 'BSpline'); f.dictionary.register_def(interp)
    op['ParametersDefined'].append(param); f.dictionary.register_def(op)
    group = f.create.OperationGroup(op, length=5 if scenario == 'mixed-clock-gain' else 24000 if scenario in ['dissolve', 'two'] else 48000, media_kind='sound')
    curve = f.create.VaryingValue(param, interp); curve.add_keyframe(0, AAFRational('0.25') if scenario in ['gain', 'held'] else AAFRational('0')); curve.add_keyframe(1, AAFRational('1')); group.parameters.append(f.create.ConstantValue(param, AAFRational('0.5')) if scenario == 'constant' else curve)
    if scenario == 'two':
        curve.pointlist[0].value = AAFRational('0.8')
        curve.pointlist[1].value = AAFRational('0.2')
        incoming = f.create.ParameterDef('48cea642-a8f9-455b-82b3-86c814b797c7', 'IncomingLevel', typedef='Rational'); f.dictionary.register_def(incoming); op['ParametersDefined'].append(incoming)
        curve_in = f.create.VaryingValue(incoming, interp); curve_in.add_keyframe(0, AAFRational('0.1')); curve_in.add_keyframe(1, AAFRational('0.6')); group.parameters.append(curve_in)
    def clip(): return f.create.SourceClip(start=0, length=48000, mob_id=master.mob_id, slot_id=1, media_kind='sound')
    if scenario in ['dissolve', 'two']:
        seq = f.create.Sequence('sound'); slot.segment = seq
        seq.components.append(clip())
        transition = f.create.Transition('sound', 24000); transition['CutPoint'].value = 12000; transition['OperationGroup'].value = group
        seq.components.append(transition); seq.components.append(clip()); seq.length = 72000
    elif scenario == 'nested-pan':
        group.segments.append(clip())
        seq = f.create.Sequence('sound'); slot.segment = seq
        seq.components.append(f.create.Filler('sound', 12000)); seq.components.append(group); seq.length = 60000
    elif scenario == 'mixed-clock-gain':
        group.segments.append(f.create.SourceClip(start=0, length=5, mob_id=master.mob_id, slot_id=1, media_kind='sound'))
        seq = f.create.Sequence('sound'); slot.segment = seq
        seq.components.append(f.create.Filler('sound', 5)); seq.components.append(group); seq.length = 10
    else:
        group.segments.append(clip()); slot.segment = group
    for mob in f.content.mobs:
        for obj, streams in mob.walk_references(): obj.validate()
`, path => new Uint8Array(readFileSync(path)));
}

for (const scenario of ['gain', 'pan', 'dissolve', 'constant', 'held', 'two'] as const) test(`AAF independently authored ${scenario} retains its audible automation`, () => {
	const document = parseAafDocument(fixture(scenario)); let ordinal = 0;
	const plan = buildTimelineInterchangeProject(document, { createStableId: prefix => `${prefix}-${++ordinal}` });
	const project = createSoundscaperProject({ ...plan.project, mixer: plan.production.mixer });
	if (scenario === 'gain') { assert.equal((project.clips[0] as unknown as AudioClipLeaf).envelope[0]?.value, .25); assert.equal((project.clips[0] as unknown as AudioClipLeaf).envelope.at(-1)?.value, 1); }
	if (scenario === 'constant') assert.equal((project.clips[0] as unknown as AudioClipLeaf).envelope[0]?.value, .5);
	if (scenario === 'held') assert.ok((project.clips[0] as unknown as AudioClipLeaf).envelope.some(point => point.frame === 47999 && point.value === .25));
	if (scenario === 'pan') { assert.equal(project.automationLanes.length, 1); assert.equal(evaluateAutomationLaneAtFrameV21(project.automationLanes[0]!, 24000, { sampleRate: 48000 }), 0); }
	if (scenario === 'two') { assert.equal((project.clips[0] as unknown as AudioClipLeaf).envelope.at(-1)?.value, .2); assert.equal((project.clips[1] as unknown as AudioClipLeaf).envelope[0]?.value, .1); }
	if (scenario === 'dissolve') {
		assert.equal(project.clips.length, 2); assert.equal(project.clips[1]?.timelineStartFrame, 24000);
		assert.equal((project.clips[0] as unknown as AudioClipLeaf).envelope.at(-1)?.value, 0); assert.equal((project.clips[1] as unknown as AudioClipLeaf).envelope[0]?.value, 0);
	}
	assert.ok(!plan.report.items.some(item => item.code === 'aaf.effect-omitted' || item.code === 'aaf.transition-omitted'));
});

test('AAF import reports nonlinear curve conversion once for one gain operation', () => {
	const document = parseAafDocument(fixture('nonlinear-gain'));
	assert.ok(document.tracks[0]?.clips[0]?.envelope?.length);
	assert.equal(document.issues.filter(item => item.code === 'aaf.interpolation-converted').length, 1);
});

test('AAF import reports a local pan as omitted without claiming its automation was preserved', () => {
	const document = parseAafDocument(fixture('nested-pan'));
	assert.equal(document.tracks[0]?.automation?.length, 0);
	assert.ok(document.issues.some(item => item.code === 'aaf.nested-pan-omitted'));
	assert.ok(!document.issues.some(item => item.code === 'aaf.automation-preserved'));
});

test('AAF gain starts and finishes on the imported clip boundaries across edit rates', () => {
	const document = parseAafDocument(fixture('mixed-clock-gain'));
	let ordinal = 0;
	const plan = buildTimelineInterchangeProject(document, { createStableId: prefix => `${prefix}-${++ordinal}` });
	const project = createSoundscaperProject({ ...plan.project, mixer: plan.production.mixer });
	const clip = project.clips[0] as unknown as AudioClipLeaf;
	assert.equal(project.sampleRate, 48_000);
	assert.equal(clip.timelineStartFrame, 5);
	assert.equal(clip.durationFrames, 6);
	assert.deepEqual(clip.envelope[0], { frame: 0, value: 0 });
	assert.deepEqual(clip.envelope.at(-1), { frame: 6, value: 1 });
});
