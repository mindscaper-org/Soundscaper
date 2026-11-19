/* SPDX-License-Identifier: AGPL-3.0-only */
import type { DawprojectDocument } from './dawproject-import.ts';
import type { DawprojectArchive } from './dawproject-archive.ts';
import { walkXml, booleanAttribute } from './dawproject-xml.ts';
import { normalizeEntryPath } from './dawproject-format.ts';

/** Only read embedded state references, within a separate 16 MiB/instance and 64 MiB/import budget. */
export async function readDawprojectDeviceStates(document: DawprojectDocument, archive: DawprojectArchive, assertCurrent: () => void) {
	const states = new Map<string, string>(), byPath = new Map<string, string>();
	let total = 0;
	for (const node of walkXml(document.root)) {
		if (node.name !== 'State' || booleanAttribute(node, 'external') === true || !node.attributes.path) continue;
		const path = normalizeEntryPath(node.attributes.path);
		const cached = byPath.get(path);
		if (cached !== undefined) { states.set(node.attributes.path, cached); continue; }
		const size = archive.entrySize(path);
		if (size === null || size > 16 * 1024 * 1024 || total + size > 64 * 1024 * 1024) continue;
		const blob = await archive.readEntry(path); assertCurrent();
		try {
			if (!blob || blob.size !== size) continue;
			const bytes = new Uint8Array(await blob.arrayBuffer()); assertCurrent();
			let encoded = '';
			for (let offset = 0; offset < bytes.length; offset += 24_576) encoded += btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24_576)));
			byPath.set(path, encoded); states.set(node.attributes.path, encoded); total += bytes.length;
		} finally { await archive.releaseEntry(path); }
	}
	return states;
}
