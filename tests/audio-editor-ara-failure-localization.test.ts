/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { araFailureLabel } from '../src/common/editor/ui/workspace/ara-failure-presentation.ts';
import { DesktopAraSessions, type AraBackend } from '../desktop/ara-session-service.ts';
import { createAraPreloadBridge } from '../desktop/ara-preload.ts';
import { ARA_CHANNELS } from '../src/common/editor/ara-contract.ts';
import { createAraEditSession } from '../src/common/editor/controller/effects/ara-edit-session.ts';
import type { AraPreparedClipEdit } from '../src/common/editor/ara-clip-editing-runtime.ts';

void test('real non-ARA plug-in admission retains its semantic reason through IPC error serialization and renderer session state', async () => {
	let closed = 0;
	const backend: AraBackend = { configure: async () => false, write: async () => undefined, bind: async () => undefined,
		openEditor: async () => undefined, render: async () => [], close: async () => { closed++; } };
	const service = new DesktopAraSessions({ isEnabled: () => true, open: async () => backend }); const owner = {};
	const bridge = createAraPreloadBridge(async (channel, request) => {
		assert.equal(channel, ARA_CHANNELS.start);
		try { return await service.start(owner, request); } catch (error) {
			assert.ok(error instanceof Error);
			throw new Error(`Error invoking remote method '${channel}': ${error.message}`, { cause: error });
		}
	});
	let cancelled = 0;
	const clip: AraPreparedClipEdit = { sourceId: 'clip', name: 'Authored $&', sampleRate: 48_000, channelCount: 1, frameCount: 4,
		sourceStartSeconds: 0, playbackStartSeconds: 0, durationSeconds: 4 / 48_000, channels: [new Float32Array(4)],
		assertCurrent() {}, cancel() { cancelled++; }, apply: async () => ({ trackId: 'track', clipId: 'clip', sourceId: 'source' }) };
	const session = createAraEditSession({ bridge, clipEditing: { prepare: async () => clip } });
	try {
		await session.open('installed-plugin');
		assert.equal(session.getSnapshot().phase, 'error');
		assert.equal(session.getSnapshot().failureCode, 'unsupported-plugin');
		assert.equal(araFailureLabel(session.getSnapshot().failureCode, { 'ui.ara.unsupportedPlugin': 'Dieses Plug-in unterstützt ARA 2 nicht.' }), 'Dieses Plug-in unterstützt ARA 2 nicht.');
		assert.match(session.getSnapshot().message, /does not support ARA 2/u);
		assert.equal(closed, 1); assert.equal(cancelled, 1);
	} finally { await session.dispose(); await service.dispose(); }
});
