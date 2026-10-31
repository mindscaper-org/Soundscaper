/* SPDX-License-Identifier: AGPL-3.0-only */
import type { PhotoDevelopInputQualityCurrentV1 as Quality } from '../common/editor/photo-develop-input-quality-current-v1.ts';
export interface DesktopPhotoDevelopAvailabilityCurrentV1 {
	read(request: Readonly<{ photoId: string; expectedRevision: number }>, options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<{ quality: Quality; locatorRevision: number | null }>>;
}
const SOURCES = new WeakMap<object, Readonly<DesktopPhotoDevelopAvailabilityCurrentV1>>();
/** The owning native factory registers only its genuine captured Develop port. */
export function registerDesktopPhotoDevelopAvailabilityCurrentV1(port: object, facet: Readonly<DesktopPhotoDevelopAvailabilityCurrentV1>): void {
	if (SOURCES.has(port)) throw new Error('Develop availability is already bound.'); SOURCES.set(port, facet);
}
/** Lookup does not reflect arbitrary Session/port/function-shaped inputs. */
export function getDesktopPhotoDevelopAvailabilityCurrentV1(value: unknown): Readonly<DesktopPhotoDevelopAvailabilityCurrentV1> | null {
	return value !== null && (typeof value === 'object' || typeof value === 'function') ? SOURCES.get(value) ?? null : null;
}
/** Explicit trusted capture alias, never discovery of a structural method. */
export function aliasDesktopPhotoDevelopAvailabilityCurrentV1(source: unknown, alias: object): void {
	const facet = getDesktopPhotoDevelopAvailabilityCurrentV1(source); if (facet) SOURCES.set(alias, facet);
}
