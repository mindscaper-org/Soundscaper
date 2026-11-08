/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/foundation/closed-domain-value.ts';
import type { ScapeProjectInputReaderFactories } from '../src/common/editor/scape-project-input.ts';

/** Capture the main-private test/host reader seam before lazy import or input
 * IO. A later change to the supplied object cannot change an admitted job. */
export function captureLightscaperNativePhotoLibraryArchiveReadersCurrentV1(value: unknown): ScapeProjectInputReaderFactories | undefined {
	if (value === undefined) return undefined;
	const input = record(value, 'native archive readers', ['blob', 'byteSource'], []);
	const result: { blob?: ScapeProjectInputReaderFactories['blob']; byteSource?: ScapeProjectInputReaderFactories['byteSource'] } = {};
	for (const key of ['blob', 'byteSource'] as const) if (Object.hasOwn(input, key)) {
		const factory = field(input, key, 'native archive readers'); if (typeof factory !== 'function') throw new TypeError('Native archive reader factory must be callable.');
		if (key === 'blob') result.blob = (...args) => Reflect.apply(factory, value, args) as ReturnType<NonNullable<ScapeProjectInputReaderFactories['blob']>>;
		else result.byteSource = (...args) => Reflect.apply(factory, value, args) as ReturnType<NonNullable<ScapeProjectInputReaderFactories['byteSource']>>;
	}
	return Object.freeze(result);
}
