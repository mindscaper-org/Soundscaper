/* SPDX-License-Identifier: AGPL-3.0-only */
import { statSync, type BigIntStats } from 'node:fs';
import { createHash } from 'node:crypto';
import { nativeChildFileIdentityFromStat, portableNativeChildFileIdentity } from './native-child-file-identity.ts';

/**
 * The main-private location one scan runs against. The digest names the
 * root-and-format pair the durable quarantine is keyed by, and the identity is
 * captured here so the grant names the directory main resolved rather than
 * whatever the path happens to point at by the time the helper opens it.
 */
export function scanRootLocation(root: Readonly<{ path: string; format: string }>) {
	const identity = fileIdentity(root.path, (entry) => entry.isDirectory());
	if (!identity) return null;
	return Object.freeze({
		path: root.path,
		identity,
		scanDigest: createHash('sha256').update(`${root.format}\u0000${root.path}`).digest('hex'),
	});
}

function fileIdentity(path: string, admits: (entry: BigIntStats) => boolean = (entry) => entry.isFile()) {
	let entry;
	try {
		entry = statSync(path, { bigint: true });
	} catch {
		return null;
	}
	if (!admits(entry)) return null;
	return portableNativeChildFileIdentity(nativeChildFileIdentityFromStat(entry));
}

export function pluginCandidateIdentity(path: string) {
	return fileIdentity(path, (entry) => entry.isFile() || entry.isDirectory());
}
