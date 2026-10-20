/* SPDX-License-Identifier: AGPL-3.0-only */
import { record } from './contracts.ts';
import { OAuthHttpError } from './oauth-http.ts';
import { trustedProviderUploadUrl, trustedProviderHookUrl, type AudiocomProviderConfiguration } from './provider-config.ts';

export const NATIVE_HASH = /^[a-f0-9]{64}$/iu;
export function nativeProject(value: unknown) {
	const data = record(value);
	if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 256) throw invalid('Invalid cloud project.');
	const head = data.latest_synced_snapshot_id ?? null;
	const size = typeof data.size === 'number' && Number.isSafeInteger(data.size) && data.size >= 0 ? data.size : 0;
	return { id: projectId(data.id), name: data.name, snapshotId: head ? snapshotId(head) : null, format: 'aup3' as const, size, transport: 'native' as const };
}
export function nativeTransferUrls(value: unknown, provider: AudiocomProviderConfiguration, project: string, snapshot: string) {
	const descriptor = record(value);
	if (provider.kind === 'audiocity') return { url: trustedProviderUploadUrl(descriptor.url, provider),
		success: trustedProviderHookUrl(descriptor.success, provider, 'success'), fail: trustedProviderHookUrl(descriptor.fail, provider, 'fail') };
	const url = checkedUrl(descriptor.url), success = checkedUrl(descriptor.success), fail = checkedUrl(descriptor.fail);
	if (url.origin !== 'https://s3.eu-central-1.wasabisys.com' || !url.pathname.startsWith('/audio.com.projects/projects/')
		|| !url.searchParams.has('X-Amz-Signature')) throw invalid('Invalid native project storage destination.');
	for (const hook of [success, fail]) if (hook.origin !== 'https://api.audio.com'
		|| !hook.pathname.startsWith(`/project/${project}/snapshot/${snapshot}/`)) throw invalid('Invalid native project transfer hook.');
	return { url, success, fail };
}
function checkedUrl(value: unknown): URL {
	if (typeof value !== 'string' || value.length > 8192) throw invalid('Invalid native project URL.');
	let url: URL; try { url = new URL(value); } catch { throw invalid('Invalid native project URL.'); }
	if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw invalid('Invalid native project URL.');
	return url;
}
export function nativePrepareInput(value: unknown) {
	const data = record(value);
	if (Object.keys(data).some(key => !['name', 'blocks', 'id', 'head'].includes(key)) || typeof data.name !== 'string'
		|| !data.name.trim() || data.name.length > 256 || [...data.name].some(c => c.charCodeAt(0) < 32)
		|| !Array.isArray(data.blocks) || data.blocks.length > 1000
		|| data.blocks.some((hash: unknown) => typeof hash !== 'string' || !NATIVE_HASH.test(hash))) throw new OAuthHttpError(400, 'invalid_request', 'Invalid native project manifest.');
	const revision = data.id !== undefined || data.head !== undefined ? { id: projectId(data.id), head: snapshotId(data.head) } : undefined;
	return { name: data.name.trim(), blocks: [...new Set((data.blocks as string[]).map(hash => hash.toUpperCase()))], revision };
}

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
export function projectId(value: unknown): string {
	if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
	if (typeof value !== 'string' || !UUID.test(value) && !/^[1-9]\d{0,15}$/u.test(value)) throw invalid('Invalid cloud project id.');
	return value;
}
export function snapshotId(value: unknown): string {
	if (typeof value !== 'string' || !UUID.test(value)) throw invalid('Invalid cloud snapshot id.');
	return value;
}
export function invalid(message: string): OAuthHttpError { return new OAuthHttpError(502, 'invalid_upstream_response', message); }
