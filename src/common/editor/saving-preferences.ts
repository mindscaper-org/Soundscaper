/* SPDX-License-Identifier: AGPL-3.0-only */

export interface SavingPreferences {
	readonly autoSaving: boolean;
	readonly askBeforeClosing: boolean;
}

export interface TemporaryDataPreferences {
	readonly limitProjects: boolean;
	readonly maximumProjects: number;
}

function record(value: unknown): Record<string, unknown> {
	if (value === undefined) return {};
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Saving preferences must be an object.');
	return value as Record<string, unknown>;
}

function boolean(value: unknown, fallback: boolean): boolean {
	if (value === undefined) return fallback;
	if (typeof value !== 'boolean') throw new TypeError('Saving preference must be boolean.');
	return value;
}

export function normalizeSavingPreferences(value?: unknown, desktop = false): SavingPreferences {
	const input = record(value);
	return { autoSaving: boolean(input.autoSaving, !desktop), askBeforeClosing: boolean(input.askBeforeClosing, true) };
}

export function normalizeTemporaryDataPreferences(value?: unknown): TemporaryDataPreferences {
	const input = record(value);
	const maximumProjects = input.maximumProjects ?? 10;
	if (typeof maximumProjects !== 'number' || !Number.isSafeInteger(maximumProjects) || maximumProjects < 1) {
		throw new RangeError('Maximum temporary projects must be a positive integer.');
	}
	return { limitProjects: boolean(input.limitProjects, true), maximumProjects };
}
