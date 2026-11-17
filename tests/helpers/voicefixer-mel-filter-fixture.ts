/* SPDX-License-Identifier: AGPL-3.0-only */
/** Synthetic DC-only filterbank; no downloaded model bytes are needed by unit tests. */
export function voiceFixerMelFilterFixture(): Uint8Array {
	const header = "{'descr': '<f4', 'fortran_order': False, 'shape': (1025, 128), }".padEnd(117, ' ') + '\n';
	const bytes = new Uint8Array(128 + 1025 * 128 * 4);
	bytes.set([147, 78, 85, 77, 80, 89, 1, 0, 118, 0]);
	bytes.set(new TextEncoder().encode(header), 10);
	new DataView(bytes.buffer).setFloat32(128, 1, true); return bytes;
}
