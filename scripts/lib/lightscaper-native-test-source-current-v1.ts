/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { extract, list } from 'tar';
import manifest from '../../config/lightscaper-libraw-runtime-manifest.json' with { type: 'json' };

/** Fresh test-owned extraction of the exact committed upstream archive. It is
 * removed with the fixture root after the runner joins all native consumers. */
export function prepareLightscaperNativeTestSourceCurrentV1(repositoryRoot: string, fixtureRoot: string): string {
	const pin = manifest.upstream.sourceArchive, bytes = readFileSync(join(repositoryRoot, pin.path));
	if (bytes.byteLength !== pin.byteLength || createHash('sha256').update(bytes).digest('hex') !== pin.sha256) throw new Error('Native RAW test source archive differs from its pin.');
	const directory = join(fixtureRoot, 'libraw-source'), archive = join(directory, 'source.tar.gz');
	mkdirSync(directory); writeFileSync(archive, bytes, { flag: 'wx' });
	let count = 0, total = 0;
	const paths = new Set<string>();
	list({ file: archive, sync: true, strict: true, onReadEntry(entry) {
		const path = entry.path.replace(/\/$/u, '');
		if (!path.startsWith('LibRaw-0.22.2') || path.split('/')[0] !== 'LibRaw-0.22.2'
			|| path.includes('\\') || path.includes('\0') || path.split('/').some(part => !part || part === '.' || part === '..')
			|| !['File', 'Directory'].includes(entry.type) || !Number.isSafeInteger(entry.size) || entry.size < 0
			|| paths.has(path) || ++count > 512 || (total += entry.size) > 16 * 1024 * 1024) throw new Error('Native RAW test archive has an unsupported entry.');
		paths.add(path);
	} });
	if (count < 100) throw new Error('Native RAW test archive inventory is incomplete.');
	extract({ file: archive, cwd: directory, sync: true, strict: true, preservePaths: false });
	return join(directory, 'LibRaw-0.22.2');
}

export function lightscaperNativeTestEnvironmentCurrentV1(environment: NodeJS.ProcessEnv, fixtureRoot: string): NodeJS.ProcessEnv {
	return { ...environment, LIGHTSCAPER_LIBRAW_SOURCE_ROOT: environment.LIGHTSCAPER_LIBRAW_SOURCE_ROOT ?? join(fixtureRoot, 'libraw-source/LibRaw-0.22.2') };
}
