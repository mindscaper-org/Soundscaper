/* SPDX-License-Identifier: AGPL-3.0-only */
import { createMissingEffect } from './effects.js';

/** Foreign processors remain ordered, inspectable and bypassed until a compatible adapter exists. */
export function interchangeMissingEffect(format: string, id: string, name: string, payload: unknown,
	enabled = true): Readonly<Record<string, unknown>> {
	const json = JSON.stringify(payload);
	if (new TextEncoder().encode(json).length > 24 * 1024 * 1024) throw new RangeError('Imported effect state exceeds its preservation budget.');
	return createMissingEffect({ id, enabled,
		missing: { name: name || 'Imported effect', nativeId: `Effect_Interchange_${format}_${encodeURIComponent(name || id)}_${encodeURIComponent(id)}`,
			reason: 'unsupported-state', source: format },
		opaqueAudacityNode: { kind: 'interchange', format, payload: JSON.parse(json) as unknown },
	});
}
