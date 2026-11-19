/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createOtioExport } from '../src/common/editor/otio-export.ts';
import { createFcpxmlExport } from '../src/common/editor/fcpxml-export.ts';
import { createOmfExport } from '../src/common/editor/omf-export.ts';
import { createAafExport } from '../src/common/editor/aaf-export.ts';
import { createDawprojectExport } from '../src/common/editor/dawproject-export.ts';
import { reportInterchangeAudioOmissions } from '../src/common/editor/controller/export/internal/interchange-audio-omissions.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { parseSoundcraftDocument } from '../src/common/editor/soundcraft-import.ts';
import { soundcraftSession } from './helpers/native-daw-import-fixtures.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

function project() {
	return { title: 'Programme', sampleRate: 48_000,
		sources: [{ id: 'source', kind: 'audio', name: 'source.wav', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 }],
		clips: [{ id: 'clip', kind: 'audio', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 24_000, durationFrames: 24_000, gain: 1 }],
		tracks: [{ id: 'track', type: 'audio', name: 'Programme', clipIds: ['clip'], gain: 1, pan: 0 }] };
}

for (const format of ['otio', 'fcpxml'] as const) test(`${format} reports active clip inserts and ignores bypassed inserts`, () => {
	const base = project();
	const effect = createEffect('delay', { id: 'clip-echo', params: { time: .25, feedback: .3, mix: .5 } });
	for (const active of [true, false]) {
		const p = { ...base, clips: [{ ...base.clips[0]!, effects: [effect], effectsActive: active }] };
		const exported = (format === 'otio' ? createOtioExport : createFcpxmlExport)({ project: p, sequenceRate: { num: 25, den: 1 } });
		const report = reportInterchangeAudioOmissions(exported.report, p);
		const item = report.items.find(item => item.code === `${format}.audio-processing-omitted`);
		if (active) { assert.ok(item); assert.deepEqual(item.data.effects, ['delay']); assert.equal(item.scope.id, 'clip'); }
		else assert.equal(item, undefined);
	}
});

test('DAWproject discloses clip insert losses with its other unsupported clip controls', () => {
	const base = project();
	const p = { ...base, clips: [{ ...base.clips[0]!, effects: [createEffect('delay', { id: 'echo' })] }] };
	const result = createDawprojectExport({ project: p });
	assert.ok(result.report.items.some(item => item.code === 'dawproject.clip-features-omitted'
		&& Array.isArray(item.data.features) && item.data.features.includes('effects')));
});

test('cut-only reports disclose the maintained master authority without warning about neutral masters', () => {
	for (const gain of [1, .25]) {
		const p = { ...project(), master: { gain, pan: 0, mute: false, effects: [] } };
		const otio = createOtioExport({ project: p, sequenceRate: { num: 25, den: 1 } });
		const fcpxml = createFcpxmlExport({ project: p, sequenceRate: { num: 25, den: 1 } });
		const reports = [reportInterchangeAudioOmissions(otio.report, p), reportInterchangeAudioOmissions(fcpxml.report, p),
			createAafExport({ project: p }).report, createOmfExport({ project: p }).report];
		for (const report of reports) assert.equal(report.items.some(item => item.code.endsWith('.mix-processing-omitted')), gain !== 1, report.subject.format);
	}
});

test('production routing and master automation are disclosed while neutral mono assignments stay quiet', () => {
	const neutral = createSoundscaperProject(project());
	const variants = [neutral,
		{ ...neutral, mixer: { ...neutral.mixer, edges: neutral.mixer.edges.map(edge => edge.source.kind === 'track' ? { ...edge, level: .25 } : edge) } },
		{ ...neutral, automationLanes: [{ id: 'master-gain', address: { kind: 'strip', strip: { kind: 'master' }, parameterId: 'gain' }, points: [{ position: 0, value: .25 }] }] },
	];
	for (const [index, project] of variants.entries()) {
		const report = createOmfExport({ project }).report;
		assert.equal(report.items.some(item => item.code === 'omf.mix-processing-omitted'), index !== 0);
	}
});

for (const [field, value] of [['pitchCents', 100], ['inverted', true], ['envelope', [{ frame: 0, value: .5 }]]] as const) {
	test(`OMF reports omitted clip ${field}`, () => {
		const base = project();
		const result = createOmfExport({ project: { ...base, clips: [{ ...base.clips[0]!, [field]: value }] } });
		assert.ok(result.report.items.some(item => item.code === 'omf.clip-processing-omitted' && item.scope.id === 'clip'));
	});
}

test('OMF reports populated labels independently of timeline annotations', () => {
	const base = project();
	const result = createOmfExport({ project: { ...base, tracks: [...base.tracks,
		{ id: 'labels', type: 'label', labels: [{ id: 'label', title: 'Chapter', startFrame: 0, endFrame: 24_000 }] }] } });
	assert.ok(result.report.items.some(item => item.code === 'omf.annotations-omitted'));
});

for (const kind of ['Aux', 'Folder', 'Master']) test(`SoundCraft ${kind} discloses nondefault stereo panner conversion`, () => {
	const base = soundcraftSession();
	const auxiliary = { id: 99, kind, name: 'Auxiliary', format: 'Stereo', mixer: { pan: [-.8, .2], output: 'Main' } };
	const parsed = parseSoundcraftDocument(JSON.stringify({ ...base, tracks: [...base.tracks, auxiliary] }));
	assert.ok(parsed.issues.some(item => item.code === 'soundcraft.pan-omitted'));
	const neutral = { ...auxiliary, mixer: { ...auxiliary.mixer, pan: [-1, 1] } };
	const unchanged = parseSoundcraftDocument(JSON.stringify({ ...base, tracks: [...base.tracks, neutral] }));
	assert.equal(unchanged.issues.some(item => item.code === 'soundcraft.pan-omitted'), false);
});
