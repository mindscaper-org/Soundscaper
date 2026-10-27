/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { centeredPeriodicHannStftChannelV1, centeredPeriodicHannIstftChannelsV1, periodicHannWindowFloat64V1 } from '../src/common/editor/assistance/internal/centered-periodic-hann-stft-v1.ts';

test('repeated channel/stem inverse transforms reuse private Hann normalization while keeping independent output', context => {
	const source = Float32Array.from({ length: 4097 }, (_, frame) => Math.fround(Math.sin(frame / 17) * 0.2 + (frame % 113 === 0 ? 0.3 : 0)));
	const spectrum = centeredPeriodicHannStftChannelV1(source);
	const padded = (spectrum.timeFrameCount - 1) * 512 + 2048;
	const original = Float64Array; let fullArrays = 0;
	Object.defineProperty(globalThis, 'Float64Array', { value: new Proxy(original, { construct(target, argumentsList, newTarget) {
		if (argumentsList[0] === padded) fullArrays += 1;
		return Reflect.construct(target, argumentsList, newTarget) as Float64Array;
	} }) });
	context.after(() => { Object.defineProperty(globalThis, 'Float64Array', { value: original }); });
	for (let channel = 0; channel < 6; channel += 1) {
		const result = centeredPeriodicHannIstftChannelsV1([spectrum], spectrum.timeFrameCount, source.length)[0]!;
		assert.equal(createHash('sha256').update(new Uint8Array(result.buffer)).digest('hex'), '52604afee7f7c4d9b7de0368119c0b482d268482b9450ebd7f0d183c08341b48');
		result.fill(0); periodicHannWindowFloat64V1().fill(0);
	}
	assert.equal(fullArrays, 7, 'one exact normalization plus six independent overlap-add accumulators');
});
