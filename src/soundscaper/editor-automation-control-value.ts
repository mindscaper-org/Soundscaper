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
