/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

// Native Node type stripping and tsx can load the same .ts URL with different
// executable offsets. A V8 merge identifies scripts only by URL; keep the
// transformed version separate until c8 remaps both onto their original source.
// A sibling pathname preserves relative map sources. A URL query would not:
// c8's fileURLToPath removes it before looking up the source-map cache.
export function coverageScriptIdentity(script, sourceMap) {
	if (!/^file:.*\.(?:[cm]?ts|tsx)$/u.test(script.url)
		|| !sourceMap?.data || !Array.isArray(sourceMap.lineLengths)) return { url: script.url, sourceMap };
	const generatedLength = sourceMap.lineLengths.reduce((sum, length) => sum + length, 0)
		+ sourceMap.lineLengths.length - 1;
	if (!script.functions.some(({ functionName, ranges }) => functionName === ''
		&& ranges[0]?.startOffset === 0 && ranges[0].endOffset === generatedLength)) {
		// A process may record both layouts at this URL, with only the loader's
		// map in its cache. Native offsets must never inherit that map.
		return { url: script.url, sourceMap: undefined };
	}
	const digest = createHash('sha256')
		.update(JSON.stringify([sourceMap.lineLengths, sourceMap.data]))
		.digest('hex');
	return { url: `${script.url}.coverage-${digest}.js`, sourceMap };
}
