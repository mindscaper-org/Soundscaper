/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';

/** Compare every sample while keeping failure diagnostics independent of PCM size. */
export function assertPcmSamplesEqual(
	actual: ArrayLike<number> | null | undefined,
	expected: ArrayLike<number>,
	context = 'PCM',
): void {
	assert.ok(actual, `${context} is available`);
	assert.ok(Object.getPrototypeOf(actual) === Object.getPrototypeOf(expected), `${context} sample representation`);
	assert.equal(actual.length, expected.length, `${context} sample count`);
	for (let frame = 0; frame < expected.length; frame++) {
		if (!Object.is(actual[frame], expected[frame])) {
			assert.equal(actual[frame], expected[frame], `${context} sample ${frame}`);
		}
	}
}

/** Keep linked-channel failures scalar instead of asking Node to diff full buffers. */
export function assertPcmChannelsEqual(
	actual: readonly ArrayLike<number>[] | null | undefined,
	expected: readonly ArrayLike<number>[],
	context = 'PCM',
): void {
	assert.ok(actual, `${context} channels are available`);
	assert.ok(Object.getPrototypeOf(actual) === Object.getPrototypeOf(expected), `${context} channel representation`);
	assert.equal(actual.length, expected.length, `${context} channel count`);
	for (let channel = 0; channel < expected.length; channel++) {
		assertPcmSamplesEqual(actual[channel], expected[channel]!, `${context} channel ${channel}`);
	}
}
