/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
import { readMidiClip, readMidiTrack } from '../src/common/editor/midi-model.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { createDawprojectExport } from '../src/common/editor/dawproject-export.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';
test('DAWproject exchange reports converting a drawn MIDI part to ordinary audio', async () => {
    const f = midiServiceFixture({ id: 'project-a' });
    const part = await f.service.addTrack();
    await f.service.addNote(part.clipId, { id: 'drawn', startFrame: 0, durationFrames: 4000, pitch: 60, velocity: 90, channel: 0 });
    const project = f.project();
    assert.ok(validateAudioEditorProjectV17(project));
    assert.equal(readMidiClip(project.clips[0])?.notes.length, 1);
    assert.ok(readMidiTrack(project.tracks[0]));
    let archive: Blob | undefined;
    const exportFixture = createFixture({ getProject: () => project, loadStoredSourceChannels: async (_store, source) => {
            const chunks = f.pcm.get(source.id);
            assert.ok(chunks);
            return [Float32Array.from(chunks.flatMap(chunk => Array.from(chunk)))];
        }, fileService: { isDesktop: false, chooseSaveTarget: async () => null,
            prepareSave: async (request) => ({ mode: 'blob', fileName: request.suggestedName, target: null }),
            saveFile: async (request) => { archive = request.blob; return { fileName: request.suggestedName }; } } });
    const exported = await createNativeProjectService(exportFixture.runtime).saveDawproject();
    assert.ok(archive);
    const opened = await createNativeProjectService(createFixture().runtime).openDawproject(new File([archive], 'Drawn MIDI.dawproject'));
    assert.ok(opened && validateAudioEditorProjectV17(opened.project));
    assert.equal(opened.project.clips.length, 1);
    assert.equal(readMidiClip(opened.project.clips[0]), null);
    assert.equal(readMidiTrack(opened.project.tracks[0]), null);
    const report = exported.report;
    assert.ok(report && typeof report === 'object' && 'items' in report && Array.isArray(report.items));
    assert.ok(report.items.some((item: unknown) => item && typeof item === 'object' && 'severity' in item
        && item.severity === 'warning' && /MIDI|note authoring/iu.test(JSON.stringify(item))), JSON.stringify(report.items));
});
test('ordinary audio does not receive a MIDI conversion warning', () => {
    const project = createAudioEditorProjectV17({ sampleRate: 8000, tracks: [createAudioTrack({ id: 'voice' }, 8000)] });
    assert.ok(validateAudioEditorProjectV17(project));
    const output = createDawprojectExport({ project: { ...project } });
    assert.equal(output.report.items.some(item => item.code === 'dawproject.midi-authoring-converted'), false);
});
test('a MIDI lane outside the delivered sequence does not receive a conversion warning', async () => {
    const fixture = midiServiceFixture();
    const part = await fixture.service.addTrack();
    await fixture.service.addNote(part.clipId, { id: 'drawn', startFrame: 0, durationFrames: 4000, pitch: 60, velocity: 90, channel: 0 });
    const project = fixture.project();
    const output = createDawprojectExport({ project: { ...project, primarySequenceId: 'empty', sequences: [
                { id: 'empty', trackNodes: [] }, { id: 'music', trackNodes: [{ kind: 'track', id: part.trackId, parentFolderId: null }] },
            ] }, sequenceId: 'empty' });
    assert.equal(output.report.items.some(item => item.code === 'dawproject.midi-authoring-converted'), false);
});
