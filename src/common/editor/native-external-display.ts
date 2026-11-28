/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Which display the clean programme output may open on, and what happens to it.
 *
 * The surface consumes the editor's own evaluated frame stream and transport
 * clock; it is a second *window*, not a second render engine. Audio is
 * untouched and keeps going to the existing selected mix device, because a
 * separate output route is a mixing decision the user did not make by opening a
 * monitor window.
 *
 * The selection is session-only and is never written into a project. A project
 * carrying "open full screen on display 2" would do something surprising on the
 * next machine, which may have one display, three, or a projector.
 *
 * Native Wayland reports unavailable rather than approximating. The protocol
 * gives a client no dependable way to place a window on a chosen output, so
 * "full screen on the display you picked" cannot be honoured; claiming it and
 * landing on the wrong screen mid-session is worse than saying so up front.
 * Linux coverage therefore runs under X11 and XWayland.
 *
 * HDR is claimed only when the display reports both HDR capability and colour
 * management. A surface that says HDR while the compositor is quietly tone
 * mapping is a grading monitor that lies.
 */

export const NATIVE_EXTERNAL_DISPLAY_WINDOWING_SYSTEMS = Object.freeze([
	'windows', 'macos', 'x11', 'wayland',
] as const);

export type NativeExternalDisplayWindowingSystem =
	(typeof NATIVE_EXTERNAL_DISPLAY_WINDOWING_SYSTEMS)[number];

/** One UHD RGBA frame fits; transfer still uses independently bounded 16 MiB chunks. */
export const NATIVE_EXTERNAL_DISPLAY_MAXIMUM_RGBA_BYTES = 64 * 1024 * 1024;

export type NativeExternalDisplayColorMode = 'hdr' | 'sdr';

export interface ExternalDisplayDescriptorV1 {
	readonly displayId: string;
	readonly label: string;
	readonly primary: boolean;
	readonly width: number;
	readonly height: number;
	readonly hdrCapable: boolean;
	readonly colorManaged: boolean;
}

/**
 * The displays the menu may offer. The primary display is excluded because the
 * editor already lives there, and native Wayland offers nothing at all.
 */
export function listSelectableExternalDisplays(
	displays: readonly ExternalDisplayDescriptorV1[],
	windowingSystem: NativeExternalDisplayWindowingSystem,
): readonly ExternalDisplayDescriptorV1[] {
	if (windowingSystem === 'wayland') return Object.freeze([]);
	return Object.freeze(displays.filter((display) => !display.primary));
}

/** A surface claims HDR only when the display is both capable and managed. */
export function resolveExternalDisplayColorMode(
	descriptor: ExternalDisplayDescriptorV1,
): NativeExternalDisplayColorMode {
	return descriptor.hdrCapable && descriptor.colorManaged ? 'hdr' : 'sdr';
}
