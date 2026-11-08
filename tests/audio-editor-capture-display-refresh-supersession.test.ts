/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createFramescaperCaptureDeviceAdapter, type FramescaperCaptureDesktopBridgeV1 } from '../src/common/editor/controller/capture/internal/framescaper-capture-device-adapter.ts';
import { createBrowserFramescaperCaptureSourcePort } from '../src/common/editor/controller/capture/internal/browser/framescaper-browser-capture-source.ts';
import { createFramescaperCaptureSessionService } from '../src/common/editor/controller/capture/internal/framescaper-capture-session-service.ts';
import { createFramescaperCaptureOriginGuard } from '../src/common/editor/controller/capture/framescaper-capture-origin-guard.ts';
import { isExpectedWorkspaceCancellation } from '../src/common/editor/ui/workspace/scape-open-decision-continuation.ts';
import { deferred, waitFor } from './helpers/async-test-control.ts';

type Inventory = Awaited<ReturnType<FramescaperCaptureDesktopBridgeV1['listSources']>>;
async function fixture(context: TestContext) {
	const requests: { generation: number; result: ReturnType<typeof deferred<Inventory>> }[] = [];
	const grants: Parameters<FramescaperCaptureDesktopBridgeV1['grant']>[0][] = [];
	const track = { kind: 'video', id: 'display', stop() {} };
	const stream = { getTracks: () => [track], getVideoTracks: () => [track], getAudioTracks: () => [] };
	const device = createFramescaperCaptureDeviceAdapter({
		sourcePort: createBrowserFramescaperCaptureSourcePort({ consumeUserAction: () => true,
			createStream: () => stream, mediaDevices: { getDisplayMedia: async () => stream } }),
		desktopBridge: {
			async status() { return { version: 1, available: true, unavailableReason: null, selectionMode: 'source-list', systemAudio: 'unavailable' }; },
			listSources(generation) { const result = deferred<Inventory>(); requests.push({ generation, result }); return result.promise; },
			async grant(request) { grants.push(request); }, async teardown() { return true; },
		},
		createRecorder: () => ({ format: { kind: 'encoded-media', mimeType: 'video/webm' }, start() {}, pause: () => true, resume: () => true, stop() {}, dispose() {} }),
	});
	const desktop = device.desktop; assert.ok(desktop); await desktop.status();
	const service = createFramescaperCaptureSessionService({ enabled: true, embedded: false,
		originGuard: createFramescaperCaptureOriginGuard(), sourcePort: device.adapter.sourcePort,
		displaySelection: desktop.port, createRecorder: device.adapter.createRecorder,
		captureOrigin: () => ({ projectFence: { schemaFamily: 'framescaper', schemaVersion: 1, projectId: 'project', baseRevision: 0, baseSha256: 'ab'.repeat(32) },
			origin: { sequenceId: 'main', playheadMicroseconds: 0, destination: 'both' } }),
		durable: { async prepare(request) { return request; }, async append(session) { return session; }, async recordPauseSpan(session) { return session; },
			async seal(session) { return session; }, async discard() {}, async findRecovery() { return null; } }, finalize() {},
	});
	context.after(async () => { for (const request of requests) request.result.resolve({ generation: request.generation, sources: [] }); await service.dispose(); await desktop.dispose(); });
	await service.initialize();
	const deliver = (index: number) => { const request = requests[index]!; request.result.resolve({ generation: request.generation,
		sources: [{ token: `screen-${request.generation}`, name: 'Screen', kind: 'screen' }] }); };
	return { service, desktop, requests, grants, deliver };
}

for (const latestFirst of [false, true]) test(`repeating enabled display refresh quietly supersedes the old read (${latestFirst ? 'latest' : 'oldest'} response first)`, async context => {
	const f = await fixture(context);
	const first = f.service.actions.listDisplaySources().then(() => null, (error: unknown) => error);
	const latest = f.service.actions.listDisplaySources();
	await waitFor(() => f.requests.length === 2, 'both native inventory reads');
	f.deliver(latestFirst ? 1 : 0); f.deliver(latestFirst ? 0 : 1);
	await latest;
	assert.equal(isExpectedWorkspaceCancellation(await first), true, 'supersession stays out of the workspace error banner');
	assert.deepEqual(f.service.snapshot.displaySources.map(source => source.token), ['screen-2']);
	f.service.actions.selectDisplaySource('screen-2'); await f.service.actions.requestPreview(['display']);
	assert.deepEqual(f.grants.map(grant => [grant.generation, grant.sourceToken]), [[2, 'screen-2']]);
	assert.equal(f.service.snapshot.phase, 'previewing');
});

test('a genuine current native generation mismatch remains a visible error', async context => {
	const f = await fixture(context);
	const current = f.service.actions.listDisplaySources().then(() => null, (error: unknown) => error);
	await waitFor(() => f.requests.length === 1, 'native inventory read');
	f.requests[0]!.result.resolve({ generation: 99, sources: [] });
	const error = await current; assert.ok(error instanceof Error);
	assert.match(error.message, /inventory generation changed/u); assert.equal(isExpectedWorkspaceCancellation(error), false);
	assert.deepEqual(f.service.snapshot.displaySources, []);
});
