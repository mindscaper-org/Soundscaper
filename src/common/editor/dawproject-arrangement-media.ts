/* SPDX-License-Identifier: AGPL-3.0-only */

import { dawprojectMediaReferences, type DawprojectDocument, type DawprojectMediaReference } from './dawproject-import.ts';
import { normalizeEntryPath } from './dawproject-format.ts';
import { attribute, booleanAttribute, childElement, type XmlElement } from './dawproject-xml.ts';
import { DAWPROJECT_MAXIMUM_TIMELINE_DEPTH } from './dawproject-import-timeline.ts';

/** Decode only audio reached by enabled arrangement clips, including declared aliases. */
export function dawprojectArrangementAudioReferences(document: DawprojectDocument): readonly DawprojectMediaReference[] {
	const paths = new Set<string>();
	const pending = document.arrangement?.lanes
		? [{ element: document.arrangement.lanes, insideClip: false, depth: 0 }] : [];
	const seen = new Map<XmlElement, Map<boolean, number>>();
	while (pending.length) {
		const current = pending.pop()!;
		const { element, insideClip, depth } = current;
		if (depth > DAWPROJECT_MAXIMUM_TIMELINE_DEPTH) continue;
		const visits = seen.get(element) ?? new Map<boolean, number>();
		if ((visits.get(insideClip) ?? Infinity) <= depth) continue;
		visits.set(insideClip, depth); seen.set(element, visits);
		if (element.name === 'Audio') {
			const file = childElement(element, 'File');
			const path = file ? attribute(file, 'path') : null;
			if (insideClip && path && file && booleanAttribute(file, 'external') !== true) paths.add(normalizeEntryPath(path));
			continue;
		}
		if (element.name === 'Clip') {
			if (booleanAttribute(element, 'enable') === false) continue;
			const reference = attribute(element, 'reference');
			const content = element.children[0] ?? (reference ? document.elementsById.get(reference) : undefined);
			if (content) pending.push({ element: content, insideClip: true, depth: depth + 1 });
			continue;
		}
		const children = element.name === 'Lanes' ? element.children
			: element.name === 'Clips' ? element.children.filter(child => child.name === 'Clip')
				: element.name === 'Warps' ? element.children.filter(child => child.name !== 'Warp').slice(0, 1) : [];
		for (const child of children) pending.push({ element: child, insideClip,
			depth: depth + (element.name === 'Lanes' ? 1 : 0) });
	}
	return dawprojectMediaReferences(document).filter(reference => reference.kind === 'audio'
		&& !reference.external && paths.has(reference.path));
}
