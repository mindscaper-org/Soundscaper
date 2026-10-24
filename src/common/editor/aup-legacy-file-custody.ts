/* SPDX-License-Identifier: AGPL-3.0-only */

interface LegacySelectedFile {
	readonly name?: unknown;
	readonly webkitRelativePath?: unknown;
}

/** Keep referenced blocks and orphan blocks from their actual selected data directories together. */
export function legacyAupDataFileCustody<File extends LegacySelectedFile>(
	selected: readonly File[], referenced: readonly File[],
): readonly File[] {
	const consumed = new Set(referenced);
	const directories = new Set<string>();
	for (const file of referenced) for (const path of paths(file)) {
		for (const prefix of directoryPrefixes(path)) {
			if (/_data$/iu.test(prefix.slice(0, -1).split('/').at(-1) ?? '')) directories.add(prefix);
		}
	}
	for (const file of selected) {
		if (consumed.has(file) || !/\.auf?$/iu.test(String(file.name ?? ''))) continue;
		if (paths(file).some(path => directoryPrefixes(path).some(prefix => directories.has(prefix)))) consumed.add(file);
	}
	return Object.freeze([...consumed]);
}

function paths(file: LegacySelectedFile): readonly string[] {
	return [file.name, file.webkitRelativePath].filter((value): value is string => typeof value === 'string' && value.length > 0)
		.map(value => value.replaceAll('\\', '/'));
}

function directoryPrefixes(path: string): readonly string[] {
	const prefixes: string[] = [];
	for (let index = path.indexOf('/'); index >= 0; index = path.indexOf('/', index + 1)) prefixes.push(path.slice(0, index + 1));
	return prefixes;
}
