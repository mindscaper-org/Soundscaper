/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact candidate enumeration and post-snapshot filesystem grants for professional peers. */

import type { Stats } from 'node:fs';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

import { canonicalNativeChildFileIdentity, nativeChildFileIdentityFromStat, type NativeChildFileIdentity } from './native-child-file-identity.ts';
import type { NativeChildIsolationPathGrant } from './native-child-isolation-launcher.ts';

/** Enumerate the complete root; helper result pages bound transport independently. */
export async function collectProfessionalCandidates(
	root: string,
	admitLeaf: (path: string, metadata: Stats) => boolean,
): Promise<readonly string[]> {
	const output: string[] = [];
	async function visit(directory: string, depth: number): Promise<void> {
		if (depth > 16) return;
		const entries = await readdir(directory, { withFileTypes: true });
		entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
		for (const entry of entries) {
			const path = resolve(directory, entry.name);
			const metadata = await lstat(path);
			if (metadata.isSymbolicLink()) continue;
			if (admitLeaf(path, metadata)) output.push(path);
			else if (metadata.isDirectory()) await visit(path, depth + 1);
		}
	}
	await visit(root, 0);
	return Object.freeze(output);
}

/** Reopen only the reviewed immutable snapshot and bind its full device/inode identity. */
export async function exactProfessionalCandidateGrant(
	path: string,
	expected: Readonly<NativeChildFileIdentity>,
	allowDirectory: boolean,
	diagnostic: string,
): Promise<NativeChildIsolationPathGrant> {
	const metadata = await lstat(path, { bigint: true });
	const identity = nativeChildFileIdentityFromStat(metadata);
	const captured = canonicalNativeChildFileIdentity(expected);
	if (metadata.isSymbolicLink() || (!metadata.isFile() && !(allowDirectory && metadata.isDirectory()))
		|| identity.dev !== captured.dev || identity.ino !== captured.ino
		|| await realpath(path) !== path) throw new Error(diagnostic);
	return Object.freeze({
		path, kind: metadata.isDirectory() ? 'directory' as const : 'file' as const, identity,
	});
}
