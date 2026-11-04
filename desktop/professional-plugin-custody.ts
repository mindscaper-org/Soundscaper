/* SPDX-License-Identifier: AGPL-3.0-only */

import { authenticatePluginCandidate } from './plugin-candidate-authentication.mjs';
import { snapshotAuthenticatedPluginCandidate } from './plugin-candidate-snapshot.mjs';
import type { HelperFileIdentity } from './helper-job-grant.ts';

/** Trusted installed plug-ins retain their location so sibling libraries and resources resolve. */
export async function prepareProfessionalPluginCandidate(
	path: string,
	expected: Readonly<{ identity: HelperFileIdentity; byteLength: number; sha256: string }>,
	userAccess: boolean,
) {
	if (!userAccess) return snapshotAuthenticatedPluginCandidate(path, expected);
	const authentication = await authenticatePluginCandidate(path);
	if (authentication.byteLength !== expected.byteLength || authentication.sha256 !== expected.sha256
		|| authentication.identity.dev !== expected.identity.dev || authentication.identity.ino !== expected.identity.ino) {
		throw new Error('The installed plug-in changed before supervised launch.');
	}
	return Object.freeze({ path, authentication, dispose: async () => undefined });
}
