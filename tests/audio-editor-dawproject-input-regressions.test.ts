/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { dawprojectMediaReferences, parseDawprojectDocument } from '../src/common/editor/dawproject-import.ts';
import { buildDawprojectProject } from '../src/common/editor/dawproject-import-project.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

function build(content: string, transport = '<Tempo value="120" unit="bpm"/>') {
	let id = 0;
	return buildDawprojectProject(parseDawprojectDocument(`<Project><Transport>${transport}</Transport>
		<Structure><Track id="track" contentType="audio"/></Structure>${content}</Project>`), {
		media: new Map([['audio/take.wav', { frameCount: 96_000, channelCount: 1, sampleRate: 48_000 }]]),
		createStableId: (prefix) => `${prefix}-${String(++id)}`,
	});
}

function clip(attributes: string) {
	return `<Arrangement><Lanes timeUnit="seconds" track="track"><Clips>
		<Clip ${attributes}><Audio timeUnit="seconds"><File path="audio/take.wav"/></Audio></Clip>
	</Clips></Lanes></Arrangement>`;
}

test('duplicate DAWproject IDs fail instead of resolving aliases to arbitrary timelines', () => {
	assert.throws(() => parseDawprojectDocument('<Project><Structure><Track id="same"/><Track id="same"/></Structure></Project>'), /duplicate/iu);
});

test('external media with the same path does not hide an embedded audio reference', () => {
	const document = parseDawprojectDocument('<Project><Audio><File path="take.wav" external="true"/></Audio><Audio><File path="take.wav"/></Audio></Project>');
	assert.deepEqual(dawprojectMediaReferences(document).map(({ external }) => external), [true, false]);
});

test('spaces at the edges of embedded filenames survive media discovery and clip lookup', () => {
	const document = parseDawprojectDocument('<Project><Audio><File path=" take.wav "/></Audio></Project>');
	assert.equal(dawprojectMediaReferences(document)[0]?.path, ' take.wav ');
});

test('DAWproject clips starting beyond source EOF are omitted instead of repeating a final sample', () => {
	const plan = build(clip('time="0" duration="1" contentTimeUnit="seconds" playStart="3"'));
	assert.deepEqual(plan.project.clips, []);
	assert.ok(plan.report.items.some(({ code }) => code === 'dawproject.clip-out-of-range'));
});

test('source audio before file origin is trimmed from the clip head without moving later audio earlier', () => {
	const plan = build(clip('time="0" duration="1" contentTimeUnit="seconds" playStart="-0.25"'));
	const imported = (plan.project.clips as Record<string, unknown>[])[0]!;
	assert.equal(imported.timelineStartFrame, 12_000);
	assert.equal(imported.sourceStartFrame, 0);
	assert.equal(imported.durationFrames, 36_000);
});

test('audio belonging only to clips before arrangement origin is absent from the resulting project', () => {
	const plan = build(clip('time="-2" duration="1" contentTimeUnit="seconds"'));
	assert.deepEqual(plan.project.clips, []);
	assert.deepEqual(plan.project.sources, []);
	assert.deepEqual(plan.media, []);
});

test('the final tempo point at a duplicate beat determines clip timing', () => {
	const plan = build(`<Arrangement><TempoAutomation><RealPoint time="0" value="120"/>
		<RealPoint time="0" value="60"/><RealPoint time="2" value="120"/><RealPoint time="2" value="180"/>
	</TempoAutomation></Arrangement>`);
	const map = plan.project.tempoMap as { events: { bpm: { num: number; den: number } }[] };
	assert.deepEqual(map.events.map(({ bpm }) => bpm.num / bpm.den), [60, 180]);
});

test('the final time-signature point at a duplicate bar determines its meter', () => {
	const plan = build(`<Arrangement><TimeSignatureAutomation>
		<TimeSignaturePoint time="4" numerator="3" denominator="4"/>
		<TimeSignaturePoint time="4" numerator="5" denominator="4"/>
	</TimeSignatureAutomation></Arrangement>`);
	const map = plan.project.signatureMap as { events: { numerator: number }[] };
	assert.deepEqual(map.events.map(({ numerator }) => numerator), [4, 5]);
});

test('beat-based fade-outs use the tempo at the clip tail', () => {
	const plan = build(`<Arrangement><TempoAutomation><RealPoint time="1" value="60"/></TempoAutomation>
		<Lanes timeUnit="beats" track="track"><Clips><Clip time="0" duration="2" fadeOutTime="1" fadeTimeUnit="beats">
		<Audio timeUnit="seconds"><File path="audio/take.wav"/></Audio></Clip></Clips></Lanes></Arrangement>`);
	const imported = (plan.project.clips as Record<string, unknown>[])[0]!;
	assert.equal(imported.fadeOutFrames, 48_000);
});

test('trimming a DAWproject clip at timeline origin keeps its existing fade gain at the retained head', () => {
	const plan = build(clip('time="-1" duration="2" contentTimeUnit="seconds" fadeTimeUnit="seconds" fadeInTime="1.5"'));
	const imported = (plan.project.clips as Record<string, unknown>[])[0]!;
	assert.equal(imported.fadeInFrames, 0);
	const envelope = imported.envelope as { frame: number; value: number }[];
	assert.ok(Math.abs(envelope[0]!.value - 2 / 3) < 1e-10);
	createCurrentAudioEditorProject(plan.project);
});

test('shortening a DAWproject clip to source EOF does not move its later fade-out earlier', () => {
	const plan = build(clip('time="0" duration="3" contentTimeUnit="seconds" fadeTimeUnit="seconds" fadeOutTime="1"'));
	const imported = (plan.project.clips as Record<string, unknown>[])[0]!;
	assert.equal(imported.fadeOutFrames, 0);
	const envelope = imported.envelope as { frame: number; value: number }[];
	assert.equal(envelope.at(-1)?.value, 1);
	createCurrentAudioEditorProject(plan.project);
});
