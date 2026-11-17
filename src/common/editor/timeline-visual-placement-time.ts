/* SPDX-License-Identifier: AGPL-3.0-only */

import { roundRational, type RationalRate } from './timeline-time.ts';

/** Transfer an existing visual coordinate directly between exact sequence grids. */
export function rebaseSequenceVisualFrame(frame: number, from: RationalRate, to: RationalRate): number {
	if (!Number.isSafeInteger(frame) || frame < 0) throw new RangeError('A visual sequence coordinate must be a non-negative safe integer.');
	return roundRational(BigInt(frame) * BigInt(from.den) * BigInt(to.num),
		BigInt(from.num) * BigInt(to.den), 'point');
}
