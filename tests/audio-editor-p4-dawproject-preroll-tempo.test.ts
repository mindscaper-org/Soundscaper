/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { writeDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';

for (const at of [-4, 0, null]) test(`File Open uses the tempo held at the arrangement origin after a point at ${String(at)}`, async () => {
	const xml = `<Project version="1.0"><Application name="Preroll tempo" version="1"/><Transport><Tempo unit="bpm" value="120" id="tempo"/></Transport>
	<Structure><Track id="voice" name="Voice" contentType="audio"><Channel role="regular" audioChannels="2"/></Track></Structure>
	<Arrangement><Lanes timeUnit="beats"><Lanes track="voice"><Clips><Clip time="2" duration="2" contentTimeUnit="seconds">
	<Audio channels="2" sampleRate="48000" duration="2"><File path="voice.wav"/></Audio></Clip></Clips></Lanes></Lanes>
	${at === null ? '' : `<TempoAutomation unit="bpm"><Target parameter="tempo"/><RealPoint time="${String(at)}" value="60" interpolation="hold"/></TempoAutomation>`}</Arrangement></Project>`;
	const pcm = new Float32Array(96_000).fill(.25);
	const archive = await writeDawprojectArchive({ projectXml: xml, metadataXml: '<MetaData/>', files: [{ path: 'voice.wav', blob: new Blob([Uint8Array.from(encodeWav([pcm, pcm], { sampleRate: 48_000, float: true }))]) }] });
	const fixture = createFixture({ adaptAudacityProject: importSoundscaperAudacityProject });
	const opened = await createNativeProjectService(fixture.runtime).openDawproject(new File([archive], 'Preroll tempo.dawproject'));
	assert.ok(opened); assert.ok(validateSoundscaperProject(opened.project)); const clip = opened.project.clips[0]; assert.ok(clip?.kind === 'audio');
	const expected = at === null ? 48_000 : 96_000;
	assert.equal(clip.timelineStartFrame, expected); assert.equal(clip.durationFrames, expected);
	assert.equal(clip.sourceStartFrame, 0); assert.equal(clip.sourceDurationFrames, expected);
});

test('preroll tempo uses the final held point while explicit zero and future points retain precedence', async () => {
	const { parseDawprojectDocument } = await import('../src/common/editor/dawproject-import.ts');
	const { buildTempoMap } = await import('../src/common/editor/dawproject-import-maps.ts');
	const { createDeliveryReport } = await import('../src/common/editor/delivery-report.ts');
	for (const [points, bpm] of [
		['<RealPoint time="-8" value="90"/><RealPoint time="-4" value="60"/>', 60],
		['<RealPoint time="-4" value="60"/><RealPoint time="0" value="120"/>', 120],
		['<RealPoint time="4" value="60"/>', 120],
	] as const) {
		const document = parseDawprojectDocument(`<Project version="1.0"><Application name="Preroll" version="1"/><Transport><Tempo unit="bpm" value="120" id="tempo"/></Transport><Arrangement><TempoAutomation unit="bpm"><Target parameter="tempo"/>${points}</TempoAutomation></Arrangement></Project>`);
		const map = buildTempoMap(document, createDeliveryReport({ format: 'dawproject' }));
		assert.deepEqual(map.events[0]?.beat, { num: 0, den: 1 }); assert.equal(map.events[0]?.bpm.num, bpm);
		assert.equal(map.events.filter(event => event.beat.num < 0).length, 0);
	}
});
