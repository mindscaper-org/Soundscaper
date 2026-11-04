/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createDesktopExportCodecQuery } from '../src/common/editor/ui/desktop-export-codec-model.ts';
import type { DesktopAudioCodecCapabilityQuery } from '../desktop/desktop-audio-codec-capability-contract.ts';
import { desktopCodecPreloadContext } from './helpers/desktop-codec-preload-context.ts';

test('the real export format query crosses the sandbox bridge with Opus and every MP3 mode', async () => {
	let calls = 0;
	const bridge = await desktopCodecPreloadContext<{ getDesktopAudioCodecCapabilities(query: unknown): Promise<unknown> }>(async (_channel, value) => {
		const query = value as DesktopAudioCodecCapabilityQuery;
		calls += 1;
		return { schemaVersion: 2, capabilities: query.operations.map(tuple => ({
			...tuple, available: true, provider: 'bundled', reason: null,
		})) };
	});
	for (const bitRateMode of ['constant', 'average', 'variable', 'preset']) {
		const query = createDesktopExportCodecQuery({
			format: 'mp3', sampleRate: '48000', channelMapping: 'stereo', bitRate: '192',
			bitRateMode, averageBitRate: '160', vbrQuality: '3', bitRatePreset: '2',
		}, 2);
		await bridge.getDesktopAudioCodecCapabilities(query);
	}
	assert.equal(calls, 4, 'no codec in the batch may prevent the capability IPC request');
});
