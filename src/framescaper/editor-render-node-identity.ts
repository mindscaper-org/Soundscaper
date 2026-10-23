/* SPDX-License-Identifier: AGPL-3.0-only */

import { fingerprintNativeMediaPlan } from '../common/editor/native-media-plan-canonical-form.ts';

/** Native logical IDs stay intact; derived render artifact IDs use a safe spelling. */
export function generatedNodeId(family: string, ownerId: string, projectIdentities: ReadonlySet<string>): string {
	const readable = `render:${family}:${ownerId}`;
	const result = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,4095}$/u.test(readable) ? readable
		: `render-sha256:${family}:${fingerprintNativeMediaPlan({ family, ownerId }).sha256}`;
	if (projectIdentities.has(result)) {
		throw new RangeError(`Generated render node identity ${result} collides with project identity.`);
	}
	return result;
}
