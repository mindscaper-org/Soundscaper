/* SPDX-License-Identifier: AGPL-3.0-only */

import { authenticatePluginCandidate } from './plugin-candidate-authentication.mjs';
import { snapshotAuthenticatedPluginCandidate } from './plugin-candidate-snapshot.mjs';
import { canonicalNativeChildFileIdentity, type NativeChildFileIdentity } from './native-child-file-identity.ts';

/** Trusted installed plug-ins retain their location so sibling libraries and resources resolve. */
export async function prepareProfessionalPluginCandidate(
	path: string,
	expected: Readonly<{ identity: NativeChildFileIdentity; byteLength: number; sha256: string }>,
	userAccess: boolean,
) {
	if (!userAccess) return snapshotAuthenticatedPluginCandidate(path, expected);
	const authentication = await authenticatePluginCandidate(path);
	const actualIdentity = canonicalNativeChildFileIdentity(authentication.identity);
	const expectedIdentity = canonicalNativeChildFileIdentity(expected.identity);
	if (authentication.byteLength !== expected.byteLength || authentication.sha256 !== expected.sha256
		|| actualIdentity.dev !== expectedIdentity.dev || actualIdentity.ino !== expectedIdentity.ino) {
		throw new Error('The installed plug-in changed before supervised launch.');
	}
	return Object.freeze({ path, authentication, dispose: async () => undefined });
}
