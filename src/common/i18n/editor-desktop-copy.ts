/* SPDX-License-Identifier: AGPL-3.0-only */

import { VAMP_DIALOG_COPY } from './editor-vamp-copy.ts';

// Desktop Soundscaper has no Framescaper surfaces. Preserve their inventory
// import contracts without shipping the unavailable product's copy owners.
const EMPTY_COPY: Readonly<Record<string, string>> = Object.freeze({});

// Vamp shares this published translation identity with the OpenFX panel.
export const FRAMESCAPER_NATIVE_SERVICES_COPY: Readonly<Record<string, string>> = Object.freeze({
	ofxParameters: VAMP_DIALOG_COPY.parameters,
});
export const FRAMESCAPER_FINISHING_ADDITIONAL_COPY = EMPTY_COPY;
export const FRAMESCAPER_VISUAL_INSPECTOR_ADDITIONAL_COPY = EMPTY_COPY;
export const FRAMESCAPER_MENUS_ADDITIONAL_COPY = EMPTY_COPY;
export const FRAMESCAPER_INPUTS_COPY = EMPTY_COPY;
export const FRAMESCAPER_FINISHING_SURFACE_COPY: Readonly<Record<string,
	Readonly<Record<string, string>>>> = Object.freeze({});
