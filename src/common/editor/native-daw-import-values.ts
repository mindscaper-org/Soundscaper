/* SPDX-License-Identifier: AGPL-3.0-only */

import { TIMELINE_INTERCHANGE_MAXIMUM_DEPTH, TIMELINE_INTERCHANGE_MAXIMUM_ITEMS } from './timeline-interchange-types.ts';

export function dawRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('A project object is required.');
	return value as Record<string, unknown>;
}

export function dawArray(value: unknown): readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError('A project array is required.');
	return value;
}

export function dawInteger(value: unknown, label: string, minimum = 0): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new RangeError(`${label} must be a safe integer at least ${minimum}.`);
	return value;
}

export function dawNumber(value: unknown, fallback: number): number {
	if (value === undefined) return fallback;
	if (typeof value !== 'number' || !Number.isFinite(value)) throw new RangeError('Project control values must be finite numbers.');
	return value;
}

export function dawText(value: unknown, fallback = ''): string {
	if (value === undefined) return fallback;
	if (typeof value !== 'string') throw new TypeError('Project names and paths must be strings.');
	return value;
}

export function dawBoolean(value: unknown, fallback = false): boolean {
	if (value === undefined) return fallback;
	if (typeof value !== 'boolean') throw new TypeError('Project flags must be booleans.');
	return value;
}

/** Bound every JSON branch, including fields outside the imported profile. */
export function boundDawJson(root: unknown): void {
	let count = 0;
	const visit = (value: unknown, depth: number): void => {
		if (++count > TIMELINE_INTERCHANGE_MAXIMUM_ITEMS) throw new RangeError('Project item limit exceeded.');
		if (depth > TIMELINE_INTERCHANGE_MAXIMUM_DEPTH) throw new RangeError('Project nesting depth limit exceeded.');
		if (value && typeof value === 'object') {
			for (const item of Object.values(value)) visit(item, depth + 1);
		}
	};
	visit(root, 0);
}
