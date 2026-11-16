/* SPDX-License-Identifier: AGPL-3.0-only */

/** Spatial rendering choices are explicit and mutually exclusive. */
export function changeSpatialExportSetting(settings: Readonly<Record<string, unknown>>, name: string, value: unknown) {
	return { ...settings, [name]: value,
		...(name === 'earLayout' && value ? { binaural: false, channelMapping: 'preserve' } : {}),
		...(name === 'binaural' && value === true ? { earLayout: '' } : {}),
	};
}
