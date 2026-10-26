/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageChannel } from 'node:worker_threads';
import { createFramescaperOpenFxFramePortBroker } from '../desktop/framescaper-openfx-frame-port.ts';
import { createFramescaperOpenFxFrameExecutionService } from '../desktop/framescaper-openfx-frame-execution.ts';
import { createFramescaperOpenFxFramePortClient, type FramescaperOpenFxFramePortOfferV1, type FramescaperOpenFxRendererMessagePort } from '../src/common/editor/ui/framescaper-native-openfx-frame-client.ts';
import { fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { nativeOpenFxFrameWorkFixture } from './helpers/native-openfx-frame-work-fixture.ts';

test('broker-owned OpenFX control authenticates one canonical plan while public service requests still admit independently', async context => {
	const plan = nativeOpenFxFrameWorkFixture(); const fingerprint = fingerprintNativeMediaPlan(plan);
	let offerListener: ((offer: FramescaperOpenFxFramePortOfferV1, port: FramescaperOpenFxRendererMessagePort) => void) | undefined;
	let currentChecks = 0;
	const service = createFramescaperOpenFxFrameExecutionService({ inventory: () => [], currentProject: () => { currentChecks += 1; return true; },
		timingAssets: async () => [], supportedGpuBackends: () => [], execute: async () => { throw new Error('missing plugin must bypass'); } });
	const broker = createFramescaperOpenFxFramePortBroker({ service,
		createMessageChannel: () => { const channel = new MessageChannel(); return { hostPort: channel.port1 as never, helperPort: channel.port2 as never }; },
		mintOpaqueId: () => 'ab'.repeat(20) });
	context.after(() => { broker.dispose(); });
	const client = createFramescaperOpenFxFramePortClient({
		openSession: async value => broker.open({}, { postMessage(_channel, offer, ports) {
			offerListener?.(offer as FramescaperOpenFxFramePortOfferV1, ports[0] as unknown as FramescaperOpenFxRendererMessagePort);
		} }, value as never),
		subscribeOffers: listener => { offerListener = listener; return () => { offerListener = undefined; }; }, mintRequestNonce: () => 'cd'.repeat(20) });
	context.after(() => { client.dispose(); });
	const parse = JSON.parse; let parses = 0;
	context.mock.method(JSON, 'parse', (value: string) => { if (value === fingerprint.canonical) parses += 1; return parse(value) as unknown; });
	const pixels = new Uint8Array(16);
	assert.equal((await client.execute({ plan, instanceId: 'effect-filter', context: 'filter', outputOrdinal: 0, requestedBackend: 'cpu',
		inputs: [{ name: 'Source', sourceRef: 'video-source', rgba: { width: 2, height: 2, pixels } }], standardParameters: {}, signal: new AbortController().signal })).mode, 'bypass');
	assert.equal(parses, 2, 'one external parse and one immutable canonical capture serve the entire main session');
	assert.equal(currentChecks, 1);
	parses = 0;
	assert.equal((await service.execute({ protocolVersion: 1, schemaFamily: 'framescaper', schemaVersion: 1, planPayload: fingerprint.canonical,
		planFingerprint: fingerprint.sha256, instanceId: 'effect-filter', outputOrdinal: 0, requestedBackend: 'cpu', transitionProgress: null,
		inputs: [{ name: 'Source', sourceRef: 'video-source', width: 2, height: 2, rgba: pixels }] })).mode, 'bypass');
	assert.equal(parses, 2, 'an unbranded public request still validates all of its external plan authority');
	assert.equal(currentChecks, 2);
});
