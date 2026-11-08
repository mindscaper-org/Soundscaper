/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { decodeDedicatedAudioFile, type BrowserDedicatedAudioFormat } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import { loadBundledWavPackAudioCodecRuntime } from '../desktop/bundled-wavpack-audio-codec-runtime.ts';
import { createDesktopAudioCodecRuntimeComposition } from '../desktop/desktop-audio-codec-runtime-composition.ts';
import type { DesktopAudioCodecCapabilityQuery } from '../desktop/desktop-audio-codec-capability-contract.ts';
import { registerDesktopOriginalFile } from '../src/common/editor/desktop-original-file-port.ts';
import { createOriginalFileOverwriteMenuItems } from '../src/common/editor/ui/original-file-overwrite-menu.ts';
import { DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER } from '../src/common/editor/desktop-main-audio-codec-runtime-marker.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';
import { WAVPACK_SPEAKER_ROLE_RECORDINGS } from './helpers/wavpack-speaker-role-fixture.ts';
import { createAudioEditorController, createMemoryEngine, createTwoTrackFixture, ENGLISH_COPY, storedChannel } from './helpers/audio-editor-multitrack-selection-harness.js';

const dependencies = { loadPayload: async (_format: BrowserDedicatedAudioFormat, url: URL) => Uint8Array.from(await readFile(url)) };
for (const recording of WAVPACK_SPEAKER_ROLE_RECORDINGS) test(`File Import admits ${recording.name} and offers only faithful Original WavPack`, async () => {
	const bundled = await loadBundledWavPackAudioCodecRuntime({ target: 'linux-x64' }); assert.ok(bundled);
	const runtime = createDesktopAudioCodecRuntimeComposition({ target: 'linux-x64', scratchRoot: '/tmp/wavpack-original-roles-test',
		createBundledRuntime: () => bundled, externalFfmpegPreferences: { admission: () => null,
			invalidateAdmission: async () => { throw new Error('No external provider configured'); } } });
	const file = new File([Uint8Array.from(Buffer.from(recording.base64, 'base64'))], `${recording.name}.wv`);
	registerDesktopOriginalFile(file, { id: '1'.repeat(48), name: file.name });
	const { store } = await createTwoTrackFixture(`wavpack-original-${recording.name}`, new Map<string, Float32Array>(), 48_000);
	const codec = { [DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER]: true, dispose() {},
		desktopAudioCodecCapabilities: (query: DesktopAudioCodecCapabilityQuery) => runtime.capabilities(query),
		async decode(blob: Blob) {
			const decoded = await decodeDedicatedAudioFile({ format: 'wavpack', input: new Uint8Array(await blob.arrayBuffer()), maximumOutputBytes: 1024 ** 2 }, dependencies);
			const view = new DataView(decoded.interleaved.buffer);
			return { sampleRate: decoded.sampleRate, channels: Array.from({ length: decoded.channelCount }, (_value, channel) =>
				Float32Array.from({ length: decoded.frameCount }, (_value, frame) => view.getFloat32((frame * decoded.channelCount + channel) * 4, true))) };
		} };
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, { headless: true, copy: ENGLISH_COPY, locale: 'en', store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: codec as unknown as Options['ffmpeg'],
		fileService: { originalOverwriteAvailable: true, releaseOriginalFile() {} } as unknown as Options['fileService'] });
	try {
		await controller.ready;
		await controller.actions.project.importFiles([file], { destination: 'timeline' });
		const project = controller.getSnapshot().project; assert.ok(validateAudioEditorProjectV17(project));
		assert.equal(project.sources[0]!.frameCount, 4800);
		assert.equal(project.sources[0]!.channelCount, recording.channels);
		for (let channel = 0; channel < recording.channels; channel++) {
			assert.deepEqual(await storedChannel(store, project.sources[0]!.id, channel), new Float32Array(4800).fill(channel ? -0.125 : 0.25));
		}
		assert.equal(controller.actions.export.overwriteOriginalAvailable(), recording.available);
		const [menu] = createOriginalFileOverwriteMenuItems({ originalFile: controller.actions.export.originalFile,
			available: controller.actions.export.overwriteOriginalAvailable, overwrite: controller.actions.export.overwriteOriginal },
		{ copy: ENGLISH_COPY, blocked: false, recording: false, importing: false, materialAvailable: true });
		assert.equal(menu?.disabled, !recording.available);
	} finally { await controller.dispose(); }
});
