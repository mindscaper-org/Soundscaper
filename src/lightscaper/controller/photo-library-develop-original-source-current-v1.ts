/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopOriginalSessionHostCore } from './photo-library-develop-original-session-core.ts';
import { capturePhotoLibraryOriginalSourceCurrentV1, type PhotoLibraryOriginalSourceCurrentV1 } from './photo-library-original-source-current-v1.ts';

type Legacy = Pick<PhotoLibraryDevelopOriginalSessionHostCore, 'loadOriginal' | 'withFrame'>;
type Facet = Pick<PhotoLibraryDevelopOriginalSessionHostCore, 'loadOriginal' | 'withFrame' | 'originalSource'>;

/** Bind the existing nested Develop facet before initialization can yield.
 * Scoped bytes can stand alone; legacy loaders retain their genuine durable
 * Blob fallback and receiver. Decoder choice stays with each named owner. */
export function capturePhotoLibraryDevelopOriginalSourceCurrentV1(scoped: PhotoLibraryOriginalSourceCurrentV1 | undefined,
	legacy?: Legacy): Readonly<Facet> | undefined {
	if (scoped === undefined && legacy === undefined) return undefined;
	const reader = legacy?.loadOriginal, decoder = legacy?.withFrame;
	if (reader !== undefined && typeof reader !== 'function' || decoder !== undefined && typeof decoder !== 'function') {
		throw new TypeError('Develop Original source requires callable selected capabilities.');
	}
	const loadOriginal: typeof reader = reader ? (original, signal) => Reflect.apply(reader, legacy, [original, signal]) as Promise<unknown> : undefined;
	const withFrame: typeof decoder = decoder ? (value, consume, dependencies) => Reflect.apply(decoder, legacy, [value, consume, dependencies]) : undefined;
	const originalSource = capturePhotoLibraryOriginalSourceCurrentV1(scoped, loadOriginal
		? (original, signal) => Reflect.apply(loadOriginal, undefined, [original, signal]) as Promise<unknown> : undefined);
	return Object.freeze({ originalSource, ...(loadOriginal ? { loadOriginal } : {}), ...(withFrame ? { withFrame } : {}) });
}
