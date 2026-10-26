/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { encodeDedicatedAudioPcm, type BrowserDedicatedAudioFormat } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';
import { resolveDesktopOriginalExportSettings } from '../src/common/editor/desktop-original-export-settings.ts';

const dependencies = { loadPayload: async (_format: BrowserDedicatedAudioFormat, url: URL) => new Uint8Array(await readFile(url)) };

for (const averageBitrateKbps of [224, 256, 320]) test(`Original MP3 export retains LAME's ${averageBitrateKbps} kbps average-rate preset`, async () => {
	const frames = 48_000;
	const pcm = Float32Array.from({ length: frames }, (_, frame) => Math.sin(frame / 10) / 4);
	const encoded = await encodeDedicatedAudioPcm({ format: 'mp3', input: new Uint8Array(pcm.buffer),
		frameCount: frames, sampleRate: 48_000, channelCount: 1, settings: { averageBitrateKbps }, maximumOutputBytes: 1024 ** 2 }, dependencies);
	const file = new File([encoded], 'Programme.mp3', { type: 'audio/mpeg' });
	const imported = await prepareStreamedAudioImport(file);
	try {
		assert.equal(imported.descriptor.frameCount, frames);
		const settings = await resolveDesktopOriginalExportSettings(file, [{ kind: 'audio', ...imported.descriptor }]);
		assert.ok(settings, 'successfully imported application output must retain its Original export shortcut');
		assert.equal(settings.bitRateMode, 'average');
		assert.equal(settings.averageBitRate, averageBitrateKbps);
	} finally { imported.dispose(); }
});
