/* SPDX-License-Identifier: AGPL-3.0-only */

const EXTENSION = 'org.soundscaper.dawproject-marker/v1';

/** Native annotations keep the source format's marker comment as opaque metadata. */
export function dawprojectMarkerExtensions(comment: string | null): Readonly<Record<string, unknown>> {
	return comment === null ? {} : { [EXTENSION]: { comment } };
}

export function dawprojectMarkerComment(annotation: Readonly<Record<string, unknown>>): string | null {
	const extensions = record(annotation.opaqueExtensions);
	const metadata = record(extensions[EXTENSION]);
	return typeof metadata.comment === 'string' ? metadata.comment : null;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {};
}
