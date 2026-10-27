/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rewriteWindowsInstalledCodecText, type WindowsInstalledCodecTextOptions } from './windows-installed-codec-text.ts';

const LEGACY = '#ifdef HAVE_UNISTD_H    /* may be set to #if 1 by ./configure */\n#  define Z_HAVE_UNISTD_H\n#endif';
const INCLUDE = '#ifndef Z_SOLO\n#  if defined(Z_HAVE_UNISTD_H)\n#    include <unistd.h>         /* for SEEK_*, off_t, and _LFS64_LARGEFILE */';
const GUARD = '#ifdef HAVE_UNISTD_H';
const NOTICE = '/* Soundscaper Windows: honor numeric header availability from FFmpeg config.h. */';

function normalized(bytes: Buffer): Buffer {
	const text = bytes.toString('utf8'), lf = text.replaceAll('\r\n', '\n');
	if (lf.split(LEGACY).length !== 2 || lf.split(INCLUDE).length !== 2
		|| [...lf.matchAll(/^#ifdef HAVE_UNISTD_H\b/gmu)].length !== 1 || lf.includes(NOTICE)) {
		throw new Error('Windows zlib header must contain exactly the pinned 1.3.1 legacy guard and independent include condition.');
	}
	const match = /^#ifdef HAVE_UNISTD_H {4}\/\* may be set to #if 1 by \.\/configure \*\/(\r?\n)# {2}define Z_HAVE_UNISTD_H\r?\n#endif$/mu.exec(text);
	if (!match) throw new Error('Windows zlib header legacy guard is malformed.');
	const replacement = NOTICE + match[1]! + '#if defined(HAVE_UNISTD_H) && HAVE_UNISTD_H';
	return Buffer.from(text.slice(0, match.index) + replacement + text.slice(match.index + GUARD.length), 'utf8');
}

/** Alter only this derived installed header, never the authenticated source
 * archive/template. Keep independent Z_HAVE_UNISTD_H and every zlib/gzip API. */
export async function normalizeWindowsZlibHeader(file: string, options: Readonly<WindowsInstalledCodecTextOptions> = {}): Promise<void> {
	await rewriteWindowsInstalledCodecText(file, 65_536, normalized, options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	if (process.argv.length !== 3) throw new TypeError('Supply one installed Windows zlib header.');
	await normalizeWindowsZlibHeader(process.argv[2]!);
}
