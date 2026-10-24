/* SPDX-License-Identifier: AGPL-3.0-only */

/** Byte-preserving ADM and split delivery cannot apply a mix loudness gain. */
export function exportDialogSupportsLoudnessNormalization(settings: Readonly<Record<string, unknown>>): boolean {
	const adm = settings.adm;
	return settings.mode === 'mix' && !(settings.format === 'bw64'
		&& adm !== null && typeof adm === 'object' && 'mode' in adm && adm.mode === 'passthrough');
}
