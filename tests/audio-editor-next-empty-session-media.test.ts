/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { createDawprojectAudioPreparer } from '../src/common/editor/controller/import/dawproject-audio-decode.ts';
import { writeDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { cloneSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { registerDesktopReadCapability } from '../src/common/editor/desktop-read-capability-registry.ts';
import { DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER } from '../src/common/editor/desktop-main-audio-codec-runtime-marker.ts';
import type { NativeProjectFileService } from '../src/common/editor/controller/document/native-project-types.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { readDawprojectImportReport } from './helpers/dawproject-archive-custody.ts';
import { clipboardProject } from './helpers/clipboard-source-custody.ts';
import { assertAudioProjectArchivePcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';

test('exact partial DAWproject Open commits healthy PCM and its empty-media error through product storage and Scape', { timeout: 20_000 }, async context => {
	type Options = NonNullable<Parameters<typeof controllerSession>[1]>;
	const { controller, store } = await controllerSession(context, {
		adaptAudacityProject: importSoundscaperAudacityProject,
		engine: { ...createMemoryEngine(), async decodeAudioData() { assert.fail('Use the real PCM WAV decoder, not a native or synthetic decoded buffer.'); } } as unknown as Options['engine'],
		engineFactory: () => { assert.fail('DAWproject custody must not render audio.'); },
	});
	const projectXml = `<Project version="1.0"><Structure><Track id="track" name="Recording" contentType="audio"><Channel role="regular"/></Track></Structure>
	<Arrangement><Lanes timeUnit="seconds"><Lanes track="track"><Clips>
	<Clip time="0" duration="0.1"><Audio timeUnit="seconds"><File path="empty.wav"/></Audio></Clip>
	<Clip name="Healthy recording" time="0.1" duration="0.1"><Audio timeUnit="seconds"><File path="healthy.wav"/></Audio></Clip>
	</Clips></Lanes></Lanes></Arrangement></Project>`;
	const samples = new Float32Array(4_800).fill(0.25);
	const archive = await writeDawprojectArchive({ metadataXml: '<MetaData/>', projectXml, files: [
		{ path: 'empty.wav', blob: new Blob([]) },
		{ path: 'healthy.wav', blob: new Blob([Uint8Array.from(encodeWav([samples], { sampleRate: 48_000, float: true }))]) },
	] });
	const previousId = controller.project?.id;
	await controller.actions.project.openDawproject(new File([archive], 'Partial.dawproject', { type: 'application/zip' }));
	const project = clipboardProject(controller.project);
	assert.notEqual(project.id, previousId);
	assert.equal(project.clips.length, 1); assert.equal(project.sources.length, 1);
	const clip = resolveRuntimeProjectProjection(project).clips[0], source = project.sources[0]; assert.ok(clip && source?.kind === 'audio');
	assert.equal(clip.title, 'Healthy recording'); assert.equal(clip.sourceId, source.id);
	assert.deepEqual([clip.timelineStartFrame, clip.durationFrames, clip.sourceStartFrame, clip.sourceDurationFrames], [4800, 4800, 0, 4800]);
	assert.deepEqual([source.sampleRate, source.frameCount, source.channelCount], [48000, 4800, 1]);
	const report = readDawprojectImportReport(controller.getSnapshot().deliveryReport);
	const errors = report.items.filter(item => item.severity === 'error');
	assert.equal(errors.length, 1); assert.equal(errors[0]?.code, 'dawproject.media-undecodable');
	assert.deepEqual(errors[0]?.scope, { kind: 'media', id: 'empty.wav' });
	assert.deepEqual(errors[0]?.data, { path: 'empty.wav', external: false });
	assert.match(JSON.stringify(errors[0]), /no decoder could read it/u);
	assert.equal(controller.getSnapshot().history.canUndo, false, 'opening a new document establishes its baseline');
	await controller.actions.project.flush({ forceCurrentSnapshot: true });
	await assertAudioProjectArchivePcm(context, store, controller.project, (_name, channels) => {
		assertPcmChannelsEqual(channels, [samples], 'all healthy DAWproject PCM, before and after fresh Scape');
	});
	assert.deepEqual(controller.getSnapshot().deliveryReport, report);
});

for (const format of ['sesx', 'dawproject'] as const) for (const emptyFirst of [true, false]) test(`${format} Open skips an empty ${emptyFirst ? 'first' : 'last'} media body and retains healthy PCM`, async () => {
	const healthy = new Blob([Uint8Array.from(encodeWav([new Float32Array(4_800).fill(0.25)], { sampleRate: 48_000, float: true }))], { type: 'audio/wav' });
	const empty = new Blob([], { type: 'audio/wav' });
	let next = 0;
	let written = 0;
	const codec = { [DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER]: true as const,
		async decode() { assert.fail('the empty body must not reach a codec'); } };
	const fixture = createFixture({ createStableId: prefix => `${prefix}-${++next}`,
		adaptAudacityProject: importSoundscaperAudacityProject,
		prepareDawprojectAudio: createDawprojectAudioPreparer(codec),
		store: { estimateStorage: async () => ({ usage: 0, quota: 1e9 }), beginSourceWrite: async () => ({
			write: async channels => {
				assert.ok(channels[0]);
				assert.deepEqual([...new Set(channels[0])], [0.25]);
				written += channels[0].length;
			}, commit: async () => undefined, abort: async () => undefined,
		}), deleteSource: async () => undefined },
	});
	const names = emptyFirst ? ['empty.wav', 'healthy.wav'] : ['healthy.wav', 'empty.wav'];
	let opened;
	if (format === 'dawproject') {
		const archive = await writeDawprojectArchive({ metadataXml: '<MetaData/>',
			files: names.map(name => ({ path: name, blob: name === 'empty.wav' ? empty : healthy })),
			projectXml: `<Project version="1.0"><Structure><Track id="track" contentType="audio"><Channel role="regular"/></Track></Structure>
			<Arrangement><Lanes timeUnit="seconds"><Lanes track="track"><Clips>${names.map((name, index) => `<Clip time="${index * 0.1}" duration="0.1"><Audio timeUnit="seconds"><File path="${name}"/></Audio></Clip>`).join('')}</Clips></Lanes></Lanes></Arrangement></Project>`,
		});
		opened = await createNativeProjectService(fixture.runtime).openDawproject(new File([archive], 'Session.dawproject'));
	} else {
		const capability = 'a'.repeat(64);
		let released = false;
		const files: NativeProjectFileService = { ...fixture.runtime.fileService, isDesktop: true,
			resolveSesxMedia: async ({ relativePath }) => ({ status: 'found', descriptor: { id: relativePath, name: relativePath,
				readProfile: 'linked-audio-range-v1', lastModified: 0, size: relativePath === 'empty.wav' ? 0 : healthy.size,
				url: `soundscaper-app://bundle/${relativePath}`, mimeType: 'audio/wav' } }),
			chooseSesxMediaFolder: async () => { assert.fail('both files exist beside the session'); },
			releaseSesxSession: async () => { released = true; return true; },
			async withReadDescriptors(descriptors, _options, consume) {
				return consume(descriptors.map(item => item.name === 'empty.wav' ? empty : healthy));
			},
		};
		const xml = `<sesx><session sampleRate="48000" audioChannelType="mono"><tracks><audioTrack><trackAudioParameters audioChannelType="mono"/>${names.map((name, index) => `<audioClip fileID="${index}" startPoint="${index * 4_800}" endPoint="${(index + 1) * 4_800}" sourceInPoint="0" sourceOutPoint="4800"/>`).join('')}</audioTrack></tracks></session><files>${names.map((name, index) => `<file id="${index}" relativePath="${name}"/>`).join('')}</files></sesx>`;
		const file = new File([xml], 'Session.sesx');
		registerDesktopReadCapability(file, capability);
		opened = await createNativeProjectService({ ...fixture.runtime, fileService: files }).openSesx(file);
		assert.equal(released, true);
	}
	assert.ok(opened);
	const project = cloneSoundscaperProject(opened.project);
	assert.equal(project.clips.length, 1);
	assert.equal(project.sources.length, 1);
	assert.equal(written, 4_800);
	const report = fixture.runtime.state.deliveryReport;
	assert.ok(report && typeof report === 'object' && 'items' in report && Array.isArray(report.items));
	assert.ok(report.items.some((item: unknown) => item !== null && typeof item === 'object'
		&& 'code' in item && item.code === `${format}.media-undecodable`));
});
