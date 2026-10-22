/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile } from 'node:fs/promises';
import { expect, test } from '../audio-editor-test-fixtures.js';
import { chooseFileAction } from '../audio-editor-test-helpers.js';
import { decodeDedicatedAudioFile } from '../../../src/common/editor/browser-dedicated-audio-codec.ts';
import { nativeCloudHash } from '../../../src/common/editor/audiocom-native-project.ts';
import { decodeAudacityBinaryXml } from '../../../src/common/editor/audacity-binary-xml.js';
import { authorize, connect, providerOrigin } from './audiocity-test-helpers.js';
import { changedArchive, hash } from './project-revision-fixtures.js';

test.setTimeout(120_000);

for (const format of ['aup3', 'aup4']) test(`${format}: saves Audacity metadata and tagged WavPack, then reuses blocks for a new revision`, async ({ page, request }) => {
	const { editor, panel } = await connect(page);
	await open(page, editor, format);
	const api = await providerApi(request);
	const first = await save(page, panel);
	const original = await api.snapshot(first.id, first.snapshotId);
	const metadata = await request.get(original.file_url);
	const bytes = await metadata.body();
	expect(bytes.subarray(0, 16).toString()).not.toBe('SQLite format 3\0');
	const dictionarySize = Number(bytes.readBigUInt64LE(0));
	const document = decodeAudacityBinaryXml(new Uint8Array(bytes.subarray(8, 8 + dictionarySize)), new Uint8Array(bytes.subarray(8 + dictionarySize)));
	expect(document.root.name).toBe('project');
	expect(original.blocks.length).toBeGreaterThan(0);
	for (const block of original.blocks) {
		const response = await request.get(block.url); const encoded = await response.body();
		expect(encoded.subarray(0, 4).toString()).toBe('wvpk');
		expect(encoded.includes(Buffer.from('FORMAT\0' + '262159'))).toBe(true);
		const id = Number(encoded.toString('latin1').split('BLOCK_ID\0')[1].match(/^\d+/u)[0]);
		const decoded = await decodeDedicatedAudioFile({ format: 'wavpack', input: new Uint8Array(encoded.subarray(0, encoded.length - encoded.readUInt32LE(encoded.length - 20))), maximumOutputBytes: 32 * 1024 * 1024 }, {
			loadPayload: async (_kind, url) => new Uint8Array(await readFile(url)),
		});
		expect(await nativeCloudHash(id, new Uint8Array(decoded.interleaved.buffer))).toBe(block.hash.toUpperCase());
	}
	await rename(editor, 'Cloud revision two');
	const transferred = [];
	page.on('request', request => { const query = new URL(request.url()).searchParams; if (query.get('phase') === 'part' && query.has('hash')) transferred.push(query.get('hash')); });
	const second = await save(page, panel);
	expect(transferred).toEqual([]);
	expect(second.id).toBe(first.id); expect(second.snapshotId).not.toBe(first.snapshotId);
	const updated = await api.snapshot(second.id, second.snapshotId);
	expect(hash(await (await request.get(updated.file_url)).body())).not.toBe(hash(bytes));
	expect((await api.history(first.id)).items.map(item => item.id)).toEqual([second.snapshotId, first.snapshotId]);
	expect((await request.get(original.file_url)).status()).toBe(200);
});

test('a competing native save reports a conflict and refresh permits the next revision', async ({ page, request }) => {
	const { editor, panel } = await connect(page); await open(page, editor);
	const api = await providerApi(request); const first = await save(page, panel);
	const external = await api.revise(first);
	await rename(editor, 'Local changed revision');
	await save(page, panel, 409);
	await expect(panel.getByRole('alert')).toContainText('Refresh');
	expect((await api.history(first.id)).items).toHaveLength(2);
	await refresh(panel);
	const retried = await save(page, panel);
	expect(retried.id).toBe(first.id);
	expect((await api.history(first.id)).items.map(item => item.id)).toEqual([retried.snapshotId, external.snapshot.id, first.snapshotId]);
});

for (const mode of ['hold-put', 'hold-sync']) test(`cancelling native ${mode} retires only the pending snapshot`, async ({ page, request }) => {
	const { editor, panel } = await connect(page); await open(page, editor);
	const api = await providerApi(request); const first = await save(page, panel);
	await rename(editor, 'Cancelled revision');
	await fault(request, mode);
	try {
		await panel.getByRole('button', { name: 'Save project', exact: true }).click();
		await expect.poll(async () => (await faultState(request)).fault?.mode).toBe(mode);
		const section = panel.locator('[data-audiocom-projects]');
		if (!await section.evaluate(element => element.open)) await section.locator('summary').click();
		await section.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect.poll(async () => (await api.history(first.id)).items.map(item => item.id)).toEqual([first.snapshotId]);
	} finally { await fault(request, null); }
	await refresh(panel); const retried = await save(page, panel);
	expect(retried.id).toBe(first.id); expect((await api.history(first.id)).items).toHaveLength(2);
});

for (const mode of ['fail-sync', 'drop-sync']) test(`native ${mode} preserves completed snapshots and recovers after refresh`, async ({ page, request }) => {
	const { editor, panel } = await connect(page); await open(page, editor);
	const api = await providerApi(request); const first = await save(page, panel);
	await rename(editor, 'Changed revision'); await fault(request, mode);
	try {
		await save(page, panel, 502);
		await expect.poll(async () => (await api.history(first.id)).items.length).toBe(mode === 'fail-sync' ? 1 : 2);
	} finally { await fault(request, null); }
	await refresh(panel); const retried = await save(page, panel);
	expect(retried.id).toBe(first.id);
	expect((await api.history(first.id)).items).toHaveLength(mode === 'fail-sync' ? 2 : 3);
});

test('disconnect and repeated OAuth login retain the same native project for the next save', async ({ page, request }) => {
	const { editor, panel } = await connect(page); await open(page, editor);
	const api = await providerApi(request); const first = await save(page, panel);
	await panel.getByRole('button', { name: 'Disconnect', exact: true }).click();
	await authorize(page, panel, { wrongPassword: true }); await rename(editor, 'After reconnect');
	const second = await save(page, panel);
	expect(second.id).toBe(first.id); expect((await api.history(first.id)).items).toHaveLength(2);
});

async function open(page, editor, format = 'aup3') {
	const chooser = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await chooser).setFiles({ name: `Native project.${format}`, mimeType: 'application/x-audacity-project', buffer: await changedArchive(format, 1) });
	await expect(editor.locator('[data-status]')).toContainText('Audacity project opened', { timeout: 30_000 });
}
async function rename(editor, name) {
	await editor.getByRole('button', { name: /^Rename track:/u }).first().dblclick();
	const input = editor.locator('[data-track-name] input'); await input.fill(name); await input.press('Enter');
}
async function save(page, panel, status = 201) {
	const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/audiocom/projects' && response.request().method() === 'POST'
		&& (new URL(response.url()).searchParams.get('phase') === 'complete' || response.status() >= 400));
	await panel.getByRole('button', { name: 'Save project', exact: true }).click();
	const completed = await response; expect(completed.status()).toBe(status);
	await expect(panel.getByRole('button', { name: 'Save project', exact: true })).toBeEnabled();
	if (status !== 201) return undefined;
	return page.evaluate(async ({ origin, snapshot }) => {
		const listed = await fetch('/api/audiocom/projects?page=1', { headers: { 'X-Audiocom-Api-Origin': origin } });
		return (await listed.json()).data.results.find(project => project.snapshotId === snapshot);
	}, { origin: providerOrigin, snapshot: new URL(completed.url()).searchParams.get('snapshot') });
}
async function refresh(panel) {
	const section = panel.locator('[data-audiocom-projects]');
	if (!await section.evaluate(element => element.open)) await section.locator('summary').click();
	await section.getByRole('button', { name: 'Refresh projects', exact: true }).click();
	await expect(section.getByRole('button', { name: 'Refresh projects', exact: true })).toBeEnabled();
}
async function fault(request, mode) {
	expect((await request.post(`${providerOrigin}/__test/archive-transfer`, { headers: { 'X-Audiocity-Test-Control': '1' }, data: { mode } })).status()).toBe(200);
}
async function faultState(request) {
	return (await request.get(`${providerOrigin}/__test/archive-transfer`, { headers: { 'X-Audiocity-Test-Control': '1' } })).json();
}
async function providerApi(request) {
	const login = await request.post(`${providerOrigin}/auth/token`, { data: { grant_type: 'password', username: 'soundscaper-validation@example.test', password: 'soundscaper-audiocity-test-only-password', scope: 'all' } });
	expect(login.status()).toBe(200);
	const headers = { Authorization: `Bearer ${(await login.json()).access_token}` };
	const get = async path => { const response = await request.get(`${providerOrigin}${path}`, { headers }); expect(response.status()).toBe(200); return response.json(); };
	return { history: id => get(`/project/${id}/snapshot?per-page=100`), snapshot: (id, snapshot) => get(`/project/${id}/snapshot/${snapshot}?expand=blocks,file_url`),
		async revise(project) {
			const current = await get(`/project/${project.id}/snapshot/${project.snapshotId}?expand=blocks,file_url`);
			const created = await request.post(`${providerOrigin}/project/${project.id}/snapshot`, { headers, data: { head_snapshot_id: project.snapshotId, blocks: current.blocks.map(block => block.hash) } });
			expect(created.status()).toBe(200); const policy = await created.json();
			expect((await request.put(policy.sync.file.url, { data: await (await request.get(current.file_url)).body() })).status()).toBe(200);
			expect((await request.post(policy.sync.file.success)).status()).toBe(200);
			expect((await request.post(`${providerOrigin}/project/${project.id}/snapshot/${policy.snapshot.id}/sync`, { headers })).status()).toBe(204);
			return policy;
		},
	};
}
