/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rewriteWindowsInstalledCodecText, type WindowsInstalledCodecTextOptions } from './windows-installed-codec-text.ts';

const MAXIMUM_BYTES = 16_384;

function normalized(bytes: Buffer): Buffer {
	const text = bytes.toString('utf8');
	if (bytes.length > MAXIMUM_BYTES || text.includes('\0') || !Buffer.from(text, 'utf8').equals(bytes)) {
		throw new Error('SVT pkg-config metadata exceeds its bounded UTF-8 text contract.');
	}
	const fields = (name: string): string[] => [...text.matchAll(new RegExp(`^[\\t ]*${name.replaceAll('.', '\\.')}:([^\\r\\n]*)`, 'gmu'))]
		.map(match => match[1]!.trim());
	if (JSON.stringify(fields('Name')) !== '["SvtAv1Enc"]' || JSON.stringify(fields('Version')) !== '["4.2.0"]'
		|| JSON.stringify(fields('Cflags.private')) !== '["-UEB_DLL"]') {
		throw new Error('SVT pkg-config metadata must have one pinned 4.2.0 identity and exactly its expected private undefine.');
	}
	const match = /^[\t ]*Cflags\.private:([\t ]*)-UEB_DLL[\t ]*(?:\r?\n|$)/mu.exec(text);
	if (!match) throw new Error('SVT pkg-config private metadata is malformed.');
	const characterOffset = match.index + match[0].indexOf('-UEB_DLL');
	const offset = Buffer.byteLength(text.slice(0, characterOffset));
	return Buffer.concat([bytes.subarray(0, offset), bytes.subarray(offset + '-UEB_DLL'.length)]);
}


/** Only derived Windows installation metadata changes. The compiler retains
 * this static ABI undefine through FFmpeg's separate compiler-only CFLAGS. */
export async function normalizeWindowsSvtPkgConfig(file: string, options: Readonly<WindowsInstalledCodecTextOptions> = {}): Promise<void> {
	await rewriteWindowsInstalledCodecText(file, MAXIMUM_BYTES, normalized, options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	if (process.argv.length !== 3) throw new TypeError('Supply one installed SVT pkg-config metadata file.');
	await normalizeWindowsSvtPkgConfig(process.argv[2]!);
}
