/* SPDX-License-Identifier: AGPL-3.0-only */

import { inspectBundledWavPackStream, type BundledWavPackStreamGeometry } from '../../../desktop/bundled-wavpack-stream.ts';

// The bundled decoder owns float32. Integer lossless groups retain their encoded
// representation so the desktop codec broker can select its qualified provider.
const LOSSLESS_INTEGER_METADATA = new Set([
	0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x09, 0x0a, 0x0c, 0x0d,
	0x21, 0x22, 0x25, 0x26, 0x27, 0x2a, 0x2b, 0x2f,
]);

export function inspectWavPackImportGroup(encoded: Uint8Array): BundledWavPackStreamGeometry {
	const inspection = inspectBundledWavPackStream(encoded);
	if (inspection.disposition === 'rejected') throw new Error(inspection.reason);
	if (inspection.disposition === 'supported') return inspection.geometry;
	const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
	for (const group of inspection.geometry.groups) {
		for (const block of group.blocks) {
			const flags = view.getUint32(block.offset + 24, true);
			if (flags & (0x8000_0000 | 0x80 | 0x8)
				|| block.metadataIds.some((id) => !LOSSLESS_INTEGER_METADATA.has(id))) {
				throw new Error(inspection.reason);
			}
		}
	}
	return inspection.geometry;
}
