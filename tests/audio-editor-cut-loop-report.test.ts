/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { exportProjectOtio, exportProjectFcpxml } from '../src/common/editor/controller/export/interchange-export-action.ts';
for (const [format, action] of [['otio', exportProjectOtio], ['fcpxml', exportProjectFcpxml]] as const)
    test(`${format} discloses a repeated source range`, async () => {
        let project = createSoundscaperProject({ sampleRate: 48000, sources: [createAudioSource({ id: 'source', storageKey: 'Take.wav', sampleRate: 48000, channelCount: 1, frameCount: 48000 })], tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] }, 48000)], clips: [createAudioClip({ id: 'clip', sourceId: 'source', durationFrames: 48000, sourceDurationFrames: 48000 })] });
        project = applySoundscaperProjectCommand(project, { type: 'clip/update', clipId: 'clip', changes: { loop: { periodFrames: 48000, durationFrames: 144000 } } });
        assert.ok(validateSoundscaperProject(project));
        let delivered: Blob | undefined;
        const result = await action({ getProject: () => project, state: {}, fileService: { saveFile(request) { assert.ok(request.blob instanceof Blob); delivered = request.blob; } } });
        assert.ok(result && delivered);
        assert.equal(await delivered.text(), result.text);
        assert.ok(result.report.items.some(item => item.severity === 'warning' && item.scope.kind === 'clip' && item.scope.id === 'clip' && /loop|repeat/iu.test(JSON.stringify(item))), JSON.stringify(result.report.items));
    });
test('a retained nonrepeating loop range does not claim a lost repeat', async () => {
    let project = createSoundscaperProject({ sampleRate: 48000,
        sources: [createAudioSource({ id: 'source', storageKey: 'Take.wav', sampleRate: 48000, channelCount: 1, frameCount: 48000 })],
        tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] }, 48000)],
        clips: [createAudioClip({ id: 'clip', sourceId: 'source', durationFrames: 48000, sourceDurationFrames: 48000 })] });
    project = applySoundscaperProjectCommand(project, { type: 'clip/update', clipId: 'clip', changes: { loop: { periodFrames: 48000, durationFrames: 48000 } } });
    assert.ok(validateSoundscaperProject(project));
    const result = await exportProjectOtio({ getProject: () => project, state: {}, fileService: { saveFile() { } } });
    assert.ok(result);
    assert.equal(result.report.items.some(item => item.scope.kind === 'clip' && /repeat/iu.test(JSON.stringify(item))), false);
});
