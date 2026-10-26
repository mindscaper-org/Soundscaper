/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MixerGraphV21 } from './mixer-graph-v21.ts';
import { createMixerRoutingClosureIndex } from './mixer-routing-closure.ts';
import type { StripRef } from './parameter-address.ts';

export interface MixerDetectorInputClosure {
	readonly strips: ReadonlySet<string>;
	readonly edgeIds: ReadonlySet<string>;
}

/** The selected rack's incoming detector graph, including upstream bus/rack inputs. */
export function mixerDetectorInputClosure(graph: MixerGraphV21, selected: StripRef): MixerDetectorInputClosure {
	// Authored capture preserves disabled routing records; executable export closures opt out.
	return createMixerRoutingClosureIndex(graph, { includeDisabled: true }).detector([selected]);
}
