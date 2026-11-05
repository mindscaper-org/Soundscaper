/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createAutomationLaneAtFrameV21, moveAutomationLanePointV21 } from '../src/common/editor/automation-lane-inline-edit-v21.ts';
import { evaluateAutomationLaneAtFrameV21, normalizeAutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import type { ParameterAddress } from '../src/common/editor/parameter-address.ts';
import { stripParameterDescriptor } from '../src/common/editor/effect-parameter-descriptors.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { walkXml } from '../src/common/editor/dawproject-xml.ts';
import { createDawprojectExport } from '../src/common/editor/dawproject-export.ts';
import { writeDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
test('a gain point dragged away from the origin survives own DAWproject File Open before that point', async () => {
    const address = { kind: 'strip' as const, strip: { kind: 'track' as const, id: 'voice' }, parameterId: 'gain' } satisfies ParameterAddress;
    const descriptor = stripParameterDescriptor(address);
    let i = 0;
    let lane = createAutomationLaneAtFrameV21({ address, descriptor, sampleRate: 8000, currentValue: 1, frame: 0, value: 0.5, createId: () => `automation-${++i}` });
    lane = moveAutomationLanePointV21(lane, { descriptor, sampleRate: 8000, pointId: lane.points[0]!.id, frame: 8000, value: 0.5 });
    let project = createSoundscaperProject({ sampleRate: 8000,
        sources: [createAudioSource({ id: 'source', storageKey: 'source', sampleRate: 8000, channelCount: 1, frameCount: 16000 })],
        tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] }, 8000)],
        clips: [createAudioClip({ id: 'clip', sourceId: 'source', durationFrames: 16000 })] });
    project = applySoundscaperProjectCommand(project, { type: 'automation-lane/set', laneId: lane.id, expected: null, lane: { ...lane } });
    assert.ok(validateSoundscaperProject(project));
    assert.equal(evaluateAutomationLaneAtFrameV21(lane, 0, { sampleRate: 8000 }), 0.5);
    const exported = createDawprojectExport({ project: { ...project } });
    const audio = encodeWav([new Float32Array(16000).fill(0.25)], { sampleRate: 8000, float: true });
    assert.ok(audio instanceof Uint8Array);
    const archive = await writeDawprojectArchive({ projectXml: exported.projectXml, metadataXml: exported.metadataXml, files: exported.media.map(media => ({ path: media.path, blob: new Blob([Uint8Array.from(audio)]) })) });
    let ordinal = 0;
    const fixture = createFixture({ adaptAudacityProject: importSoundscaperAudacityProject, createStableId: prefix => `${prefix}-${++ordinal}` });
    const opened = await createNativeProjectService(fixture.runtime).openDawproject(new File([archive], 'Gain point.dawproject'));
    assert.ok(opened && validateSoundscaperProject(opened.project));
    const imported = opened.project.automationLanes[0];
    assert.ok(imported);
    assert.equal(evaluateAutomationLaneAtFrameV21(imported, 0, { sampleRate: 8000 }), 0.5);
    assert.equal(evaluateAutomationLaneAtFrameV21(imported, 4000, { sampleRate: 8000 }), 0.5);
});
for (const timebase of ['absolute-samples', 'musical-beats'] as const) {
    for (const parameterId of ['gain', 'pan', 'mute'] as const)
        test(`DAWproject pins the held ${parameterId} origin for ${timebase}`, () => {
            const address = { kind: 'strip' as const, strip: { kind: 'track' as const, id: 'voice' }, parameterId };
            const value = parameterId === 'gain' ? 0.5 : parameterId === 'pan' ? -0.5 : 1;
            const lane = normalizeAutomationLaneV21({ id: 'held', address, timebase,
                points: [{ id: 'first', position: timebase === 'absolute-samples' ? 8000 : { num: 2, den: 1 }, value }], segments: [] }, { descriptor: stripParameterDescriptor(address) });
            const project = createSoundscaperProject({ sampleRate: 8000,
                tracks: [createAudioTrack({ id: 'voice' }, 8000)], automationLanes: [lane] });
            assert.ok(validateSoundscaperProject(project));
            const output = createDawprojectExport({ project: { ...project } });
            const points = [...walkXml(output.document)].filter(element => element.name === (parameterId === 'mute' ? 'BoolPoint' : 'RealPoint'));
            assert.equal(points.length, 2);
            assert.equal(points[0]?.attributes.time, '0');
            assert.equal(points[0]?.attributes.value, parameterId === 'mute' ? 'true' : parameterId === 'pan' ? '0.25' : '0.5');
            assert.equal(points[1]?.attributes.time, timebase === 'absolute-samples' ? '1' : '2');
            assert.equal(lane.points.length, 1, 'delivery must not mutate authored anchors');
        });
}
