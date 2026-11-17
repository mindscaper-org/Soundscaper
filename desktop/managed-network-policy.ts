/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ManagedFeature, ManagedPolicy } from './managed-policy.ts';

/** Checks precede native pickers, process spawning, and third-party browser handoff. */
export function enforceManagedIpc(policy: ManagedPolicy, channel: string, args: readonly unknown[]): void {
	let feature: ManagedFeature | null = null;
	if (channel === 'soundscaper:v1:updates:check') feature = 'ApplicationUpdatesAllowed';
	else if (channel === 'soundscaper:v1:external:open') feature = 'ExternalLinksAllowed';
	else if (channel === 'soundscaper:v1:assistance:install') feature = 'ModelDownloadsAllowed';
	else if (channel === 'soundscaper:v1:ffmpeg:install') feature = 'ExternalCodecInstallationAllowed';
	else if (channel.startsWith('soundscaper:v1:freesound:')) feature = 'FreesoundAllowed';
	else if (channel.startsWith('soundscaper:v1:audiocom:')) feature = 'AudiocomAllowed';
	else if (channel === 'soundscaper:v1:mcp:start') feature = 'LocalIntegrationsAllowed';
	else if (channel === 'soundscaper:blender:select' && (args[0] as { live?: unknown } | undefined)?.live !== false) feature = 'LocalIntegrationsAllowed';
	if (feature) policy.assertAllowed(feature);
	if (channel.endsWith(':authorize') || channel === 'soundscaper:v1:audiocom:link') policy.assertAllowed('ExternalLinksAllowed');
}

export function managedFetch(policy: ManagedPolicy, feature: ManagedFeature, fetchImpl: typeof fetch = fetch): typeof fetch {
	return async (input, init) => {
		policy.assertAllowed(feature);
		return fetchImpl(input, init);
	};
}

export function managedRequestAllowed(policy: ManagedPolicy, address: string): boolean {
	const url = new URL(address);
	if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return true;
	if (!policy.allows('OnlineFeaturesAllowed')) return false;
	if (url.hostname === 'freesound.org' || url.hostname.endsWith('.freesound.org')
		|| /^\/api\/freesound(?:\/|$)/u.test(url.pathname)) return policy.allows('FreesoundAllowed');
	if (url.hostname === 'audio.com' || url.hostname.endsWith('.audio.com')
		|| /^\/api\/audiocom(?:\/|$)/u.test(url.pathname)) return policy.allows('AudiocomAllowed');
	return true;
}

interface NetworkSession {
	readonly webRequest: { onBeforeRequest(listener: (details: { url: string }, callback: (result: { cancel: boolean }) => void) => void): void };
}
/** Install before navigation on every application/guest session. Own one request listener. */
export function installManagedRequestPolicy(policy: ManagedPolicy, session: NetworkSession, feature?: ManagedFeature): void {
	session.webRequest.onBeforeRequest((details, callback) => {
		callback({ cancel: (feature !== undefined && !policy.allows(feature)) || !managedRequestAllowed(policy, details.url) });
	});
}
