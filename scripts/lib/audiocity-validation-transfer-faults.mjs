/* SPDX-License-Identifier: AGPL-3.0-only */

/** Wrap only the disposable loopback server; production Audiocity has no fault routes. */
export function installArchiveTransferFaults(app, ctx) {
	const modes = ['hold-put', 'hold-sync', 'fail-sync', 'drop-sync'];
	const handlers = app.server.listeners('request');
	let armed = null;
	let fault = null;
	let release = () => {};
	for (const handler of handlers) app.server.removeListener('request', handler);
	app.server.on('request', (request, response) => {
		void dispatch(request, response).catch(() => {
			if (!response.headersSent) response.writeHead(500);
			response.end();
		});
	});
	async function dispatch(request, response) {
		const path = new URL(request.url, ctx.config.publicUrl).pathname;
		if (path === '/__test/archive-transfer') {
			if (request.headers['x-audiocity-test-control'] !== '1') { response.writeHead(403); response.end(); return; }
			if (request.method === 'POST') {
				let body = '';
				for await (const chunk of request) {
					body += chunk.toString();
					if (body.length > 1024) throw new Error('Oversized fault configuration.');
				}
				const mode = JSON.parse(body).mode ?? null;
				if (mode !== null && !modes.includes(mode)) { response.writeHead(422); response.end(); return; }
				release(); release = () => {}; fault = null; armed = mode;
			} else if (request.method !== 'GET') { response.writeHead(405); response.end(); return; }
			response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
			response.end(JSON.stringify({ armed, fault,
				archiveBytes: ctx.db.get("SELECT COALESCE(SUM(size),0) bytes FROM blobs WHERE kind='project-archive' AND state IN ('uploaded','ready')").bytes,
			}));
			return;
		}
		const upload = /^\/uploads\/([a-f0-9-]{36})$/u.exec(path);
		const sync = /^\/project\/([a-f0-9-]{36})\/snapshot\/([a-f0-9-]{36})\/sync$/u.exec(path);
		const blob = upload && request.method === 'PUT' ? ctx.blobs.get(upload[1]) : null;
		if (armed && (armed === 'hold-put' ? blob?.kind === 'project-archive' : sync && request.method === 'POST')) {
			const mode = armed; armed = null;
			const snapshotId = blob?.resource_id ?? sync[2];
			const projectId = ctx.db.get('SELECT project_id FROM snapshots WHERE id=?', snapshotId)?.project_id;
			fault = { mode, projectId, snapshotId };
			if (mode.startsWith('hold-')) await new Promise(resolve => { release = resolve; });
			if (mode === 'fail-sync') { response.writeHead(503); response.end(); return; }
			if (mode === 'drop-sync') {
				const end = response.end.bind(response);
				response.end = (...args) => {
					if (response.statusCode === 200) { fault = { ...fault, mode: 'dropped-sync' }; response.destroy(); return response; }
					return end(...args);
				};
			}
		}
		for (const handler of handlers) handler.call(app.server, request, response);
	}
	return { dispose() { armed = null; release(); } };
}
