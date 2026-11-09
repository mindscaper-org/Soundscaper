/* SPDX-License-Identifier: AGPL-3.0-only */

export const TIMELINE_INTERCHANGE_EXTENSIONS = Object.freeze(['.edl', '.otio', '.fcpxml', '.omf', '.omfi'] as const);
export const TIMELINE_INTERCHANGE_EXTENSION_LIST = TIMELINE_INTERCHANGE_EXTENSIONS.join(',');

export function isTimelineInterchangeFile(value: unknown): boolean {
	return typeof value === 'string' && /\.(?:edl|otio|fcpxml|omfi?)$/iu.test(value);
}
