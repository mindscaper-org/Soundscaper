/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ParameterDescriptor } from '../common/editor/parameter-address.ts';

export function normalizeControlValue(value: unknown, descriptor: ParameterDescriptor): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)) {
		throw new RangeError('Automation control value must be a finite canonical number.');
	}
	if (value < descriptor.minimum || value > descriptor.maximum) {
		throw new RangeError('Automation control value is outside its parameter range.');
	}
	return value;
}

export function nonNegativeFrame(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError('Automation frame authority must be a non-negative safe integer.');
	}
	return Number(value);
}

export function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}

export function safeIncrement(value: number, name: string): number {
	const next = value + 1;
	if (!Number.isSafeInteger(next)) throw new RangeError(`${name} overflowed.`);
	return next;
}
