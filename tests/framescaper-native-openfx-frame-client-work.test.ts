/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createFramescaperOpenFxFramePortClient } from '../src/common/editor/ui/framescaper-native-openfx-frame-client.ts';
import { nativeOpenFxFrameWorkFixture } from './helpers/native-openfx-frame-work-fixture.ts';

for (const planes of [1, 2]) test(`renderer captures and fingerprints a ${String(planes)}-plane OpenFX frame exactly once`, async context => {
	const plan = nativeOpenFxFrameWorkFixture(); const pixels = new Uint8Array(16).fill(7);
	const stringify = JSON.stringify; let canonicalVisits = 0;
	context.mock.method(JSON, 'stringify', (value: unknown) => { if (value === plan.project.id) canonicalVisits += 1; return stringify(value); });
	const digest = crypto.subtle.digest.bind(crypto.subtle); let digests = 0;
	context.mock.method(crypto.subtle, 'digest', async (algorithm: AlgorithmIdentifier, data: BufferSource) => { digests += 1; return digest(algorithm, data); });
	const set = Uint8Array.prototype.set; let aggregateCopies = 0;
	context.mock.method(Uint8Array.prototype, 'set', function (this: Uint8Array, values: ArrayLike<number>, offset?: number) {
		if (this.byteLength === planes * 16 && values.length === 16) aggregateCopies += 1;
		set.call(this, values, offset);
	});
	let control: { planPayload: string; inputs: { sha256: string }[]; inputBinding: { sha256: string } } | undefined;
	const client = createFramescaperOpenFxFramePortClient({ openSession: async value => {
		control = value as typeof control; throw new Error('renderer construction reached main admission');
	}, subscribeOffers: () => () => undefined, mintRequestNonce: () => 'ab'.repeat(20) });
	context.after(() => { client.dispose(); });
	await assert.rejects(client.execute({ plan, instanceId: 'effect-filter', context: 'filter', outputOrdinal: 0, requestedBackend: 'cpu',
		inputs: Array.from({ length: planes }, (_, index) => ({ name: index === 0 ? 'Source' : 'Aux', sourceRef: 'video-source', rgba: { width: 2, height: 2, pixels } })),
		standardParameters: {}, signal: new AbortController().signal }), /renderer construction reached/u);
	assert.equal(canonicalVisits, 1, 'the fingerprint already owns the exact canonical string');
	assert.equal(digests, planes === 1 ? 1 : planes + 1, 'one-plane aggregate has the identical admitted plane digest');
	assert.equal(aggregateCopies, planes === 1 ? 0 : planes);
	assert.ok(control); assert.equal(control.inputBinding.sha256, createHash('sha256').update(new Uint8Array(planes * 16).fill(7)).digest('hex'));
	assert.equal(control.inputs[0]!.sha256, createHash('sha256').update(pixels).digest('hex'));
	assert.equal(pixels.byteLength, 16, 'caller PCM stays attached');
});
