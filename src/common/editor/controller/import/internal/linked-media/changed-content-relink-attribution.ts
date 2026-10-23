/* SPDX-License-Identifier: AGPL-3.0-only */

export function changedContentRelinkClassification(source: object): 'changed-content' {
	if (Object.hasOwn(source, 'provenance')) {
		throw new Error(
			'Import the selected file as new media to preserve attribution; '
			+ 'changed-content relink is unavailable for an attributed source.',
		);
	}
	const kind: unknown = Object.getOwnPropertyDescriptor(source, 'kind')?.value;
	if ((kind === 'audio' || kind === 'video') && Object.hasOwn(source, 'contentSha256')) {
		throw new Error(
			`Import the selected file as new media to preserve its authenticated ${kind} content; `
			+ 'changed-content relink cannot rewrite the project content identity.',
		);
	}
	return 'changed-content';
}
