/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import type { NativeProjectFileService } from '../src/common/editor/controller/document/native-project-types.ts';
import { registerDesktopReadCapability } from '../src/common/editor/desktop-read-capability-registry.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';

// Audition identifies crossfade partners per clip; another unlinked foreground
// clip must still occlude those clips (Adobe's documented top-most-clip rule).
for (const direction of ['head', 'tail'] as const) {
	test(`SESX File Open scopes a ${direction} crossfade exemption to its actual partner`, async () => {
		const replacementStart = direction === 'tail' ? 1200 : 6000;
		const xml = `<sesx><session sampleRate="48000" audioChannelType="mono"><tracks><audioTrack id="10001">
			<trackParameters><name>Dialogue</name></trackParameters><trackAudioParameters audioChannelType="mono"/>
			<audioClip id="0" fileID="0" name="Bed" startPoint="0" endPoint="4800" sourceInPoint="0" sourceOutPoint="4800" zOrder="1" crossFadeTailClipID="1"/>
			<audioClip id="1" fileID="0" name="Linked partner" startPoint="3600" endPoint="8400" sourceInPoint="0" sourceOutPoint="4800" zOrder="2" crossFadeHeadClipID="0"/>
			<audioClip id="2" fileID="0" name="Replacement" startPoint="${replacementStart}" endPoint="${replacementStart + 1200}" sourceInPoint="0" sourceOutPoint="1200" zOrder="3" clipAutoCrossfade="false"/>
			</audioTrack></tracks></session><files><file id="0" relativePath="voice.wav"/></files></sesx>`;
		const project = await open(xml);
		const at = (frame: number) => project.clips.filter(clip => clip.timelineStartFrame <= frame
			&& clip.timelineStartFrame + clip.durationFrames > frame).map(clip => clip.title).sort();
		assert.deepEqual(at(replacementStart + 600), ['Replacement'], 'an unrelated unlinked edit must not mix the hidden crossfading clip');
		assert.deepEqual(at(4000), ['Bed', 'Linked partner'], 'the actual linked pair retains the existing independent-fades conversion');
		assert.deepEqual(at(600), ['Bed']);
		assert.deepEqual(at(3000), ['Bed']);
		const affectedTitle = direction === 'tail' ? 'Bed' : 'Linked partner';
		assert.deepEqual(project.clips.filter(clip => clip.title === affectedTitle).map(clip => [
			clip.timelineStartFrame, clip.sourceStartFrame, clip.durationFrames,
		]), direction === 'tail' ? [[0, 0, 1200], [2400, 2400, 2400]]
			: [[3600, 0, 2400], [7200, 3600, 1200]]);
	});
}

test('SESX File Open keeps an ordinary linked pair mixed without another foreground edit', async () => {
	const xml = `<sesx><session sampleRate="48000" audioChannelType="mono"><tracks><audioTrack>
		<audioClip id="0" fileID="0" name="Outgoing" startPoint="0" endPoint="4800" sourceInPoint="0" sourceOutPoint="4800" zOrder="1" crossFadeTailClipID="1"/>
		<audioClip id="1" fileID="0" name="Incoming" startPoint="1200" endPoint="6000" sourceInPoint="0" sourceOutPoint="4800" zOrder="2" crossFadeHeadClipID="0"/>
		</audioTrack></tracks></session><files><file id="0" relativePath="voice.wav"/></files></sesx>`;
	const project = await open(xml);
	assert.deepEqual(project.clips.map(clip => [clip.title, clip.timelineStartFrame, clip.durationFrames]), [
		['Outgoing', 0, 4800], ['Incoming', 1200, 4800],
	]);
});

async function open(xml: string) {
	const audio = new Blob([Uint8Array.from(encodeWav([new Float32Array(4800).fill(.25)], { sampleRate: 48_000, float: true }))]);
	let nextId = 0, frames = 0;
	const fixture = createFixture({ adaptAudacityProject: importSoundscaperAudacityProject,
		createStableId: prefix => `${prefix}-${++nextId}`,
		store: { estimateStorage: async () => ({ usage: 0, quota: 1e9 }),
			beginSourceWrite: async () => ({ write: async channels => { frames += channels[0]?.length ?? 0; },
				commit: async () => undefined, abort: async () => undefined }), deleteSource: async () => undefined },
	});
	const fileService = { ...fixture.runtime.fileService, isDesktop: true,
		resolveSesxMedia: async () => ({ status: 'found', descriptor: { id: 'read', name: 'voice.wav', size: audio.size,
			lastModified: 0, mimeType: 'audio/wav', readProfile: 'linked-audio-range-v1', url: 'soundscaper-app://media/voice' } }),
		chooseSesxMediaFolder: async () => ({ status: 'cancelled' }),
		withReadDescriptors: async (_descriptors, _options, consume) => await consume([audio]),
		releaseSesxSession: async () => true,
	} satisfies NativeProjectFileService;
	const file = new File([xml], 'Dialogue.sesx'); registerDesktopReadCapability(file, 'a'.repeat(64));
	const opened = await createNativeProjectService({ ...fixture.runtime, fileService }).openSesx(file);
	assert.ok(opened); assert.ok(validateSoundscaperProject(opened.project));
	assert.equal(frames, 4800, 'the referenced WAV is decoded and staged once');
	assert.deepEqual(fixture.switched, [opened.project.id]);
	return resolveRuntimeProjectProjection(opened.project);
}
