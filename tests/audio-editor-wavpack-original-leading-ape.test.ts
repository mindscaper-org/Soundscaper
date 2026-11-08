/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { decodeDedicatedAudioFile, encodeDedicatedAudioPcm, type BrowserDedicatedAudioFormat } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import { loadBundledWavPackAudioCodecRuntime } from '../desktop/bundled-wavpack-audio-codec-runtime.ts';
import { createDesktopAudioCodecRuntimeComposition } from '../desktop/desktop-audio-codec-runtime-composition.ts';
import type { DesktopAudioCodecCapabilityQuery } from '../desktop/desktop-audio-codec-capability-contract.ts';
import { createApeFileMetadata } from '../src/common/editor/ape-file-metadata.ts';
import { registerDesktopOriginalFile } from '../src/common/editor/desktop-original-file-port.ts';
import { resolveDesktopOriginalExportSettings } from '../src/common/editor/desktop-original-export-settings.ts';
import { createOriginalFileOverwriteMenuItems } from '../src/common/editor/ui/original-file-overwrite-menu.ts';
import { DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER } from '../src/common/editor/desktop-main-audio-codec-runtime-marker.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';
import { withWavPackTotalFrames } from './helpers/wavpack-import-fixture.ts';
import { createAudioEditorController, createMemoryEngine, createTwoTrackFixture, ENGLISH_COPY, storedChannel } from './helpers/audio-editor-multitrack-selection-harness.js';

const dependencies = { loadPayload: async (_format: BrowserDedicatedAudioFormat, url: URL) => Uint8Array.from(await readFile(url)) };
async function recording(pcm: Float32Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
	return withWavPackTotalFrames(await encodeDedicatedAudioPcm({ format: 'wavpack', input: new Uint8Array(pcm.buffer), frameCount: pcm.length,
		channelCount: 1, sampleRate: 48_000, settings: { compressionLevel: 2 }, maximumOutputBytes: 1024 ** 2 }, dependencies), pcm.length);
}

for (const footer of [true, false]) test(`File Import retains Original WavPack past leading APEv2 (footer ${footer})`, async () => {
	const pcm = Float32Array.from({ length: 4800 }, (_value, index) => Math.sin(index / 30) / 4);
	const encoded = await recording(pcm);
	const bundled = await loadBundledWavPackAudioCodecRuntime({ target: 'linux-x64' }); assert.ok(bundled);
	const runtime = createDesktopAudioCodecRuntimeComposition({ target: 'linux-x64', scratchRoot: '/tmp/wavpack-original-prefix-test',
		createBundledRuntime: () => bundled, externalFfmpegPreferences: { admission: () => null,
			invalidateAdmission: async () => { throw new Error('No external provider configured'); } } });
	for (const leading of [false, true]) {
		let tag = createApeFileMetadata({ title: 'Leading archived performance' });
		if (!footer) { new DataView(tag.buffer).setUint32(20, 0xe000_0000, true); tag = tag.slice(0, -32); }
		const file = new File([...(leading ? [tag] : []), encoded], `Performance ${leading}.wv`, { type: 'audio/wavpack' });
		registerDesktopOriginalFile(file, { id: (leading ? '2' : '1').repeat(48), name: file.name });
		const { store } = await createTwoTrackFixture(`wavpack-original-${footer}-${leading}`, new Map<string, Float32Array>(), 48_000);
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
			assert.equal(project.sources[0]!.frameCount, pcm.length);
			assert.deepEqual(await storedChannel(store, project.sources[0]!.id, 0), pcm);
			assert.equal(controller.actions.export.overwriteOriginalAvailable(), true);
			const [menu] = createOriginalFileOverwriteMenuItems({ originalFile: controller.actions.export.originalFile,
				available: controller.actions.export.overwriteOriginalAvailable, overwrite: controller.actions.export.overwriteOriginal },
			{ copy: ENGLISH_COPY, blocked: false, recording: false, importing: false, materialAvailable: true });
			assert.equal(menu?.disabled, false);
		} finally { await controller.dispose(); }
	}
});

test('Original WavPack seeks over large APE payloads and refuses inconsistent headers', async () => {
	const encoded = await recording(new Float32Array(4800).fill(0.25));
	const tag = createApeFileMetadata({ title: 'A'.repeat(2 * 1024 ** 2) });
	const file = new File([tag, encoded], 'Large tag.wv');
	const reads: number[] = [];
	const source = { kind: 'audio', sampleRate: 48_000, channelCount: 1 };
	const settings = await resolveDesktopOriginalExportSettings({ name: file.name, size: file.size,
		slice(start: number, end: number) { reads.push(end - start); return file.slice(start, end); } }, [source]);
	assert.equal(settings?.sampleFormat, 'float32');
	assert.ok(reads.every((length, index) => length <= (index === 0 ? 1024 ** 2 : 32)));
	const bad = Uint8Array.from(tag); new DataView(bad.buffer).setUint32(12, tag.length * 2, true);
	for (const prefix of [bad, tag.slice(0, -1)]) {
		assert.equal(await resolveDesktopOriginalExportSettings(new File([prefix, encoded], 'Bad tag.wv'), [source]), null);
	}
});
