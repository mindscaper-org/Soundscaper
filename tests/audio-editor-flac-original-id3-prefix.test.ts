/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { encodeDedicatedAudioPcm } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import { loadBundledFlacAudioCodecRuntime } from '../desktop/bundled-flac-audio-codec-runtime.ts';
import { createDesktopAudioCodecRuntimeComposition } from '../desktop/desktop-audio-codec-runtime-composition.ts';
import type { DesktopAudioCodecCapabilityQuery } from '../desktop/desktop-audio-codec-capability-contract.ts';
import { createAudioMetadataId3Tag } from '../src/common/editor/id3-metadata.js';
import { registerDesktopOriginalFile } from '../src/common/editor/desktop-original-file-port.ts';
import { resolveDesktopOriginalExportSettings } from '../src/common/editor/desktop-original-export-settings.ts';
import { createOriginalFileOverwriteMenuItems } from '../src/common/editor/ui/original-file-overwrite-menu.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';
import { createAudioEditorController, createMemoryEngine, createTwoTrackFixture, ENGLISH_COPY, storedChannel } from './helpers/audio-editor-multitrack-selection-harness.js';

async function recording(): Promise<Uint8Array<ArrayBuffer>> {
	const pcm = Float32Array.from({ length: 4608 }, (_, index) => Math.sin(index / 30) / 4);
	return encodeDedicatedAudioPcm({ format: 'flac', input: new Uint8Array(pcm.buffer), frameCount: pcm.length,
		channelCount: 1, sampleRate: 48_000, settings: { compressionLevel: 5 }, maximumOutputBytes: 1024 ** 2 },
	{ loadPayload: async (_format, url) => Uint8Array.from(await readFile(url)) });
}

test('File Import retains Original FLAC after every admitted leading ID3 tag', async () => {
	const encoded = await recording();
	const bundled = await loadBundledFlacAudioCodecRuntime({ target: 'linux-x64' }); assert.ok(bundled);
	const runtime = createDesktopAudioCodecRuntimeComposition({ target: 'linux-x64', scratchRoot: '/tmp/flac-original-prefix-test',
		createBundledRuntime: () => bundled, externalFfmpegPreferences: { admission: () => null,
			invalidateAdmission: async () => { throw new Error('No external provider configured'); } } });
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input, init) => input instanceof URL && input.protocol === 'file:'
		? new Response(Uint8Array.from(await readFile(input))) : originalFetch(input, init);
	try {
		for (const count of [0, 1, 2]) {
			const file = new File([...Array.from({ length: count }, (_value, index) => createAudioMetadataId3Tag({ title: `Tag ${index}` })), encoded],
				`Tagged ${count}.flac`, { type: 'audio/flac' });
			registerDesktopOriginalFile(file, { id: String(count + 1).repeat(48), name: file.name });
			const { store } = await createTwoTrackFixture(`flac-original-prefix-${count}`, new Map<string, Float32Array>(), 48_000);
			const codec = { dispose() {}, desktopAudioCodecCapabilities: (query: DesktopAudioCodecCapabilityQuery) => runtime.capabilities(query) };
			type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
			const controller = createAudioEditorController(null, { headless: true, copy: ENGLISH_COPY, locale: 'en', store,
				engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: codec as unknown as Options['ffmpeg'],
				fileService: { originalOverwriteAvailable: true, releaseOriginalFile() {} } as unknown as Options['fileService'] });
			try {
				await controller.ready;
				await controller.actions.project.importFiles([file], { destination: 'timeline' });
				const project = controller.getSnapshot().project; assert.ok(validateAudioEditorProjectV17(project));
				assert.equal(project.sources.length, 1);
				assert.equal(project.sources[0]!.frameCount, 4608);
				assert.ok((await storedChannel(store, project.sources[0]!.id, 0)).some((value: number) => Math.abs(value) > 0.1));
				assert.equal(controller.actions.export.overwriteOriginalAvailable(), true, `${count} admitted tags must retain eligible Original FLAC`);
				const [menu] = createOriginalFileOverwriteMenuItems({ originalFile: controller.actions.export.originalFile,
					available: controller.actions.export.overwriteOriginalAvailable, overwrite: controller.actions.export.overwriteOriginal },
				{ copy: ENGLISH_COPY, blocked: false, recording: false, importing: false, materialAvailable: true });
				assert.equal(menu?.disabled, false);
			} finally { await controller.dispose(); }
		}
	} finally { globalThis.fetch = originalFetch; }
});

test('Original FLAC seeks over large tag payloads without reading them into its scanner', async () => {
	const encoded = await recording();
	const length = 2 * 1024 ** 2;
	const first = Uint8Array.from(createAudioMetadataId3Tag({ title: 'Large title tag' }));
	for (let index = 0; index < 4; index++) first[9 - index] = length >>> (7 * index) & 127;
	const second = createAudioMetadataId3Tag({ artist: 'Second tag' });
	const file = new File([first, new Uint8Array(10 + length - first.length), second, encoded], 'Large tagged.flac');
	const reads: [number, number][] = [];
	const source = { kind: 'audio', sampleRate: 48_000, channelCount: 1 };
	const actual = await resolveDesktopOriginalExportSettings({ name: file.name, size: file.size,
		slice(start: number, end: number) { reads.push([start, end]); return file.slice(start, end); } }, [source]);
	assert.ok(actual);
	assert.equal(actual.bitDepth, 24);
	assert.ok(reads.every(([start, end], index) => end - start <= (index === 0 ? 1024 ** 2 : 42)));
	assert.ok(reads.some(([start]) => start >= 10 + length + second.length));
});

test('Original FLAC still refuses unprovable tags, STREAMINFO and unsupported bit depths', async () => {
	const encoded = await recording(); const source = { kind: 'audio', sampleRate: 48_000, channelCount: 1 };
	const tag = Uint8Array.from(createAudioMetadataId3Tag({ title: 'Valid tag' }));
	const invalidSize = Uint8Array.from(tag); invalidSize[6] = 128;
	const truncated = Uint8Array.from(tag); truncated[6] = 1;
	const badStreamInfo = Uint8Array.from(encoded); badStreamInfo[7] = 33;
	const unsupported = Uint8Array.from(encoded); unsupported[20] &= 254; unsupported[21] &= 15; // one-bit FLAC is outside the encoder profile
	for (const parts of [[invalidSize, encoded], [truncated, encoded], [tag.subarray(0, 9)],
		[tag, badStreamInfo], [tag, unsupported]]) {
		assert.equal(await resolveDesktopOriginalExportSettings(new File(parts, 'Unprovable.flac'), [source]), null);
	}
});
