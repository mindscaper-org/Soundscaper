/* SPDX-License-Identifier: AGPL-3.0-only */

const PUBLISHED_RAW_ASSETS = new Set([
	'https://assets.soundscaper.org/runtime/libraw/0.22.2/libraw.wasm',
	'https://assets.soundscaper.org/runtime/libraw/0.22.2/recovery-abi2/libraw-recovery.wasm',
]);

/** Choose a transport location without granting new executable-byte authority.
 * The caller still verifies the unchanged publication pin, digest and memory.
 * Packaged Lightscaper ships those same bytes under its own runtime mount. */
export function resolveLibRawRuntimeAssetUrlCurrentV1(
	publishedUrl: string,
	documentHref: string | undefined = globalThis.location?.href,
): string {
	if (!PUBLISHED_RAW_ASSETS.has(publishedUrl)) throw new TypeError('Unknown pinned LibRaw runtime URL.');
	if (documentHref === undefined) return publishedUrl;
	const context = new URL(documentHref);
	if (context.protocol !== 'lightscaper-app:') return publishedUrl;
	const authority = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]*)/u.exec(documentHref)?.[1];
	if (authority !== 'bundle' || context.hostname !== 'bundle' || context.port || context.username || context.password) {
		throw new TypeError('Packaged Lightscaper RAW requires its exact application origin.');
	}
	return `lightscaper-app://bundle${new URL(publishedUrl).pathname}`;
}
