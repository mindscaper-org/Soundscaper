/* SPDX-License-Identifier: AGPL-3.0-only */
import { MAX_UPLOAD_BYTES, record } from './contracts.ts';
import { accessTokenForSession, type OAuthHandlerDependencies } from './oauth-handlers.ts';
import { handleOAuthEndpoint, oauthJson, oauthResponseHeaders, OAuthHttpError, readJsonBody, readUpstreamJson, type AudiocomOAuthFunctionContext } from './oauth-http.ts';
import { providerConfiguration } from './provider-config.ts';
import { selectedProviderContext } from './provider-selection.ts';
import { checkResponse, providerFetch } from './provider-fetch.ts';
import { nativePrepareInput, nativeProject, nativeTransferUrls, NATIVE_HASH, projectId, snapshotId, invalid } from './project-contracts.ts';
import { exactUploadStream } from './streams.ts';

/** Native Audacity metadata/block synchronization is shared by both providers. */
export function handleAudiocomProjectsRequest(context: AudiocomOAuthFunctionContext, dependencies: OAuthHandlerDependencies = {}): Promise<Response> {
	return handleOAuthEndpoint(context, ['GET', 'POST', 'DELETE'], async admission => {
		context = selectedProviderContext(context);
		const { accessToken, authorized } = await accessTokenForSession(context, dependencies);
		context = authorized.context;
		const provider = providerConfiguration(context.env);
		if (!['all', 'public projects'].includes(authorized.session.grant.provider?.scope ?? 'public')) throw new OAuthHttpError(403, 'project_access_required', 'Reconnect to authorize project saving.');
		const control = async (path: string, init: RequestInit = {}): Promise<unknown> => {
			const response = await providerFetch(context, dependencies, new URL(path, provider.apiOrigin), { ...init,
				headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
			if (response.status === 409) { await response.body?.cancel(); throw new OAuthHttpError(409, 'project_conflict', 'The project changed on the server. Refresh the project list before saving another revision.'); }
			await checkResponse(response, authorized, dependencies);
			if (response.status === 204) { await response.body?.cancel(); return null; }
			return readUpstreamJson(response, 4 * 1024 * 1024);
		};
		const query = new URL(context.request.url).searchParams;
		if ([...query.keys()].some(key => !['phase', 'project', 'snapshot', 'hash', 'page'].includes(key) || query.getAll(key).length !== 1)) throw new OAuthHttpError(400, 'invalid_request', 'Invalid native project parameters.');
		if (context.request.method === 'GET') {
			if (query.size > 1 || query.size === 1 && !query.has('page') || !/^[1-9]\d{0,5}$/u.test(query.get('page') ?? '1')) throw new OAuthHttpError(400, 'invalid_request', 'Invalid project page.');
			const page = Number(query.get('page') ?? '1');
			const data = record(await control(`/project?per-page=20&page=${page}`));
			const pagination = record(data.pagination);
			if (!Array.isArray(data.items) || data.items.length > 20 || pagination.page !== page || !Number.isSafeInteger(pagination.pages)) throw invalid('Invalid native project list.');
			return oauthJson({ data: { results: data.items.filter((item: unknown) => record(item).transport !== 'file').map(nativeProject), page, hasNext: page < Number(pagination.pages) } }, 200, admission);
		}
		if (context.request.method === 'POST' && query.get('phase') === 'prepare') {
			if (query.size !== 1) throw new OAuthHttpError(400, 'invalid_request', 'Invalid project preparation.');
			const input = nativePrepareInput(await readJsonBody(context.request));
			if (input.revision) {
				const current = record(await control(`/project/${input.revision.id}`));
				if (record(current.head).id !== input.revision.head) throw new OAuthHttpError(409, 'project_conflict', 'The project changed on the server. Refresh the project list.');
			}
			const created = record(await control(input.revision ? `/project/${input.revision.id}/snapshot` : '/project', {
				method: 'POST', body: JSON.stringify({ name: input.name, blocks: input.blocks, ...(input.revision ? { head_snapshot_id: input.revision.head } : {}) }),
			}));
			const project = nativeProject(created.project), snapshot = snapshotId(record(created.snapshot).id);
			if (input.revision && project.id !== input.revision.id) throw invalid('The prepared revision belongs to a different project.');
			const sync = record(created.sync);
			if (!Array.isArray(sync.blocks) || sync.blocks.length > input.blocks.length) throw invalid('Invalid native block descriptors.');
			nativeTransferUrls(sync.file, provider, project.id, snapshot);
			const missing = sync.blocks.map((value: unknown) => {
				const descriptor = record(value), hash = String(descriptor.id).toLowerCase();
				if (!NATIVE_HASH.test(hash) || !input.blocks.includes(hash.toUpperCase())) throw invalid('Unexpected native block.');
				nativeTransferUrls(descriptor, provider, project.id, snapshot); return hash;
			});
			return oauthJson({ data: { projectId: project.id, snapshotId: snapshot, missing } }, 201, admission);
		}
		const project = projectId(query.get('project')), snapshot = snapshotId(query.get('snapshot'));
		const base = `/project/${project}/snapshot/${snapshot}`;
		if (context.request.method === 'DELETE') {
			if (query.size !== 2) throw new OAuthHttpError(400, 'invalid_request', 'Invalid project cancellation.');
			const current = record(await control(base));
			if (current.date_synced !== 0) throw new OAuthHttpError(409, 'project_conflict', 'A completed project revision cannot be cancelled.');
			await control(base, { method: 'DELETE' });
			return new Response(null, { status: 204, headers: oauthResponseHeaders(admission.corsOrigin) });
		}
		const phase = query.get('phase');
		if (!['part', 'complete'].includes(phase ?? '') || query.size !== (phase === 'part' && query.has('hash') ? 4 : 3)) throw new OAuthHttpError(400, 'invalid_request', 'Invalid native project operation.');
		const current = record(await control(`/project/${project}`));
		if (record(current.head).id !== snapshot) throw new OAuthHttpError(409, 'project_conflict', 'The project head changed. Refresh the project list.');
		const state = record(await control(base));
		if (state.date_synced !== 0) throw new OAuthHttpError(409, 'project_conflict', 'The revision is already complete. Refresh the project list.');
		if (phase === 'complete') {
			await control(`${base}/sync`, { method: 'POST' });
			const completed = nativeProject(await control(`/project/${project}`));
			if (completed.snapshotId !== snapshot) throw invalid('Project synchronization did not complete.');
			return oauthJson({ data: completed }, 201, admission);
		}
		const size = context.request.headers.get('X-Audiocom-Content-Length') ?? '';
		if (!/^[1-9]\d{0,8}$/u.test(size) || Number(size) > MAX_UPLOAD_BYTES || !context.request.body
			|| context.request.headers.get('Content-Type') !== 'application/octet-stream') throw new OAuthHttpError(413, 'invalid_upload_size', 'Invalid native project part size.');
		const hash = query.get('hash');
		if (hash !== null && !NATIVE_HASH.test(hash)) throw new OAuthHttpError(400, 'invalid_request', 'Invalid native block hash.');
		const sync = record(await control(`${base}/sync`));
		if (!Array.isArray(sync.blocks) || sync.blocks.length > 1000) throw invalid('Invalid native block descriptors.');
		const part = hash === null ? sync.file : sync.blocks.find((value: unknown) => String(record(value).id).toLowerCase() === hash.toLowerCase());
		if (!part) throw new OAuthHttpError(409, 'project_conflict', 'The requested native part is no longer pending.');
		const urls = nativeTransferUrls(part, provider, project, snapshot);
		try {
			const transfer = exactUploadStream(context.request.body, Number(size));
			const response = await providerFetch(context, dependencies, urls.url, { method: 'PUT', body: transfer.body,
				headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': size } }, true);
			if (!response.ok) { await response.body?.cancel(); throw invalid('The native project transfer failed.'); }
			await response.body?.cancel(); await transfer.completed;
			const confirmed = await providerFetch(context, dependencies, urls.success, { method: 'POST' });
			if (!confirmed.ok) { await confirmed.body?.cancel(); throw invalid('The native project confirmation failed.'); }
			await confirmed.body?.cancel();
		} catch (error) {
			try { const response = await (dependencies.fetchImpl ?? fetch)(urls.fail, { method: 'DELETE', redirect: 'manual', signal: AbortSignal.timeout(10000) }); await response.body?.cancel(); } catch { /* The client also retires its pending snapshot. */ }
			throw error;
		}
		return new Response(null, { status: 204, headers: oauthResponseHeaders(admission.corsOrigin) });
	});
}
