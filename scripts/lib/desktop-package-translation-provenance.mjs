/* SPDX-License-Identifier: AGPL-3.0-only */
const SHA256 = /^[a-f\d]{64}$/u;
export function assertDesktopPackageTranslationProvenance(runtime) {
	// Audacity's reviewed strings are committed source bundled into the renderer,
	// so the package carries no translation resource tree to verify: the asar and
	// renderer closure checks above already cover those bytes. What the manifest
	// must still carry is which upstream translation state was compiled in.
	const translations = runtime.translations;
	if (!plainRecord(translations)
		|| typeof translations.headSha !== 'string' || translations.headSha === ''
		|| !Number.isSafeInteger(translations.artifactId) || translations.artifactId <= 0
		|| !SHA256.test(String(translations.mappingSha256))
		|| !Array.isArray(translations.locales) || translations.locales.length === 0
		|| translations.locales.some((locale) => typeof locale !== 'string' || locale === '')) {
		throw new Error('The desktop runtime manifest has no Audacity translation provenance.');
	}

}
function plainRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
