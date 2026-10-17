/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { expect, test } from '../audio-editor-test-fixtures.js';
import { chooseFileAction, disableNativeSavePicker, trackNameText } from '../audio-editor-test-helpers.js';
import { authorize, connect, providerOrigin } from './audiocity-test-helpers.js';
import { changedArchive, hash } from './project-revision-fixtures.js';

test.setTimeout(120_000);

for (const format of ['aup3', 'aup4']) {
	test(`${format}: successive changed saves retain one project, every revision, and reopenable bytes`, async ({ page, request }) => {
		await disableNativeSavePicker(page);
		const { editor, panel } = await connect(page);
		const api = await providerApi(request);
		const files = await changedFiles(format);
		let project;
		const snapshots = [];
		for (let index = 0; index < files.length; index++) {
			project = await save(page, panel, format, files[index], `success-${format}-${index + 1}`, project);
			snapshots.push(project.snapshotId);
			const bytes = await download(page, project);
			expect(hash(bytes)).toBe(hash(files[index]));
			await openArchive(page, editor, format, bytes, index + 1);
		}
		expect(new Set(snapshots).size).toBe(3);
		const history = await api.history(project.id);
		expect(history.items.map(item => item.id)).toEqual([...snapshots].reverse());
		for (let index = 0; index < files.length; index++) {
			const historical = await download(page, { ...project, snapshotId: snapshots[index] });
			expect(hash(historical)).toBe(hash(files[index]));
		}
		await page.reload();
		await expect(panel.getByText('Connected to Audiocity', { exact: true })).toBeVisible();
		await refresh(panel);
		const row = panel.locator(`[data-audiocom-project-id="${project.id}"]`);
		await expect(row).toHaveCount(1);
		const event = page.waitForEvent('download');
		await row.getByRole('button', { name: /^Download project/u }).click();
		expect(hash(await readFile(await (await event).path()))).toBe(hash(files[2]));
	});

	test(`${format}: a competing save rejects a stale head and refresh permits an explicit changed retry`, async ({ page, request }) => {
		const { panel } = await connect(page);
		const api = await providerApi(request);
		const files = await changedFiles(format);
		const first = await save(page, panel, format, files[0], `conflict-${format}-1`);
		const external = await api.saveRevision(first, format, files[1]);
		await save(page, panel, format, files[2], `conflict-${format}-3`, first, 409);
		await expect(panel.getByRole('alert')).toContainText('Refresh the archive list');
		expect((await api.history(first.id)).items.map(item => item.id)).toEqual([external.snapshot.id, first.snapshotId]);
		expect(hash(await download(page, { ...first, snapshotId: external.snapshot.id }))).toBe(hash(files[1]));
		await refresh(panel);
		const third = await save(page, panel, format, files[2], `conflict-${format}-3`, { ...first, snapshotId: external.snapshot.id });
		expect(third.id).toBe(first.id);
		expect((await api.history(first.id)).items).toHaveLength(3);
		expect(hash(await download(page, third))).toBe(hash(files[2]));
	});

	for (const mode of ['hold-put', 'hold-sync']) test(`${format}: cancelling ${mode} preserves the prior save and permits a changed retry`, async ({ page, request }) => {
		const { panel } = await connect(page);
		const api = await providerApi(request);
		const files = await changedFiles(format);
		const first = await save(page, panel, format, files[0], `${mode}-${format}-1`);
		const baseline = (await faultState(request)).archiveBytes;
		await setFault(request, mode);
		try {
			await chooseArchive(page, panel, format, files[1], `${mode}-${format}-2`, first);
			await expect.poll(async () => (await faultState(request)).fault?.mode).toBe(mode);
			const fault = (await faultState(request)).fault;
			expect(fault.projectId).toBe(first.id);
			if (mode === 'hold-sync') expect((await faultState(request)).archiveBytes).toBe(baseline + files[1].length);
			await archives(panel).getByRole('button', { name: 'Cancel', exact: true }).click();
			await expect.poll(async () => (await api.history(first.id)).items.map(item => item.id)).toEqual([first.snapshotId]);
			await expect.poll(async () => (await faultState(request)).archiveBytes).toBe(baseline);
		} finally { await setFault(request, null); }
		expect(hash(await download(page, first))).toBe(hash(files[0]));
		await refresh(panel);
		const retried = await save(page, panel, format, files[2], `${mode}-${format}-3`, first);
		expect(retried.id).toBe(first.id);
		expect((await api.history(first.id)).items).toHaveLength(2);
		expect(hash(await download(page, retried))).toBe(hash(files[2]));
	});

	test(`${format}: late completion cannot replace a newer save made during its upload`, async ({ page, request }) => {
		const { panel } = await connect(page);
		const api = await providerApi(request);
		const files = await changedFiles(format);
		const first = await save(page, panel, format, files[0], `late-${format}-1`);
		await setFault(request, 'hold-sync');
		const saving = save(page, panel, format, files[1], `late-${format}-2`, first, 409);
		let newer;
		try {
			await expect.poll(async () => (await faultState(request)).fault?.mode).toBe('hold-sync');
			const pending = (await faultState(request)).fault.snapshotId;
			newer = await api.saveRevision({ ...first, snapshotId: pending }, format, files[2]);
		} finally { await setFault(request, null); }
		await saving;
		expect((await api.get(`/project/${first.id}`)).latest_synced_snapshot_id).toBe(newer.snapshot.id);
		expect(hash(await download(page, { ...first, snapshotId: newer.snapshot.id }))).toBe(hash(files[2]));
		expect(hash(await download(page, first))).toBe(hash(files[0]));
		await refresh(panel);
	});

	for (const mode of ['fail-sync', 'drop-sync']) test(`${format}: ${mode} recovers after refresh without losing completed revisions`, async ({ page, request }) => {
		const { panel } = await connect(page);
		const api = await providerApi(request);
		const files = await changedFiles(format);
		const first = await save(page, panel, format, files[0], `${mode}-${format}-1`);
		await setFault(request, mode);
		try {
			await save(page, panel, format, files[1], `${mode}-${format}-2`, first, 502);
			const history = await api.history(first.id);
			expect(history.items).toHaveLength(mode === 'fail-sync' ? 1 : 2);
			if (mode === 'drop-sync') expect(hash(await download(page, { ...first, snapshotId: history.items[0].id }))).toBe(hash(files[1]));
		} finally { await setFault(request, null); }
		await refresh(panel);
		const current = (await api.get(`/project/${first.id}`)).latest_synced_snapshot_id;
		const retried = await save(page, panel, format, files[2], `${mode}-${format}-3`, { ...first, snapshotId: current });
		expect(retried.id).toBe(first.id);
		expect((await api.history(first.id)).items).toHaveLength(mode === 'fail-sync' ? 2 : 3);
		expect(hash(await download(page, retried))).toBe(hash(files[2]));
		expect(hash(await download(page, first))).toBe(hash(files[0]));
	});
}

test('disconnect and repeated OAuth login preserve access to an existing project and its next changed save', async ({ page }) => {
	const { panel } = await connect(page);
	const files = await changedFiles('aup3');
	let project = await save(page, panel, 'aup3', files[0], 'login-roundtrip-1');
	for (let index = 1; index < 3; index++) {
		await panel.getByRole('button', { name: 'Disconnect', exact: true }).click();
		await authorize(page, panel, { wrongPassword: index === 1 });
		await refresh(panel);
		project = await save(page, panel, 'aup3', files[index], `login-roundtrip-${index + 1}`, project);
		expect(hash(await download(page, project))).toBe(hash(files[index]));
	}
});

function archives(panel) { return panel.locator('[data-audiocom-projects]'); }
async function changedFiles(format) {
	const files = await Promise.all([1, 2, 3].map(revision => changedArchive(format, revision)));
	expect(new Set(files.map(hash)).size, 'successive saves must contain different valid project files').toBe(3);
	return files;
}
async function chooseArchive(page, panel, format, bytes, name, revision) {
	const section = archives(panel);
	if (!await section.evaluate(element => element.open)) await section.locator('summary').click();
	await section.getByRole('button', { name: 'Upload AUP3 or AUP4', exact: true }).click();
	const [chooser] = await Promise.all([page.waitForEvent('filechooser'),
		page.getByRole('menuitem', { name: revision ? `Save new revision: ${revision.name}` : 'Upload new project', exact: true }).click()]);
	await chooser.setFiles({ name: `${name}.${format}`, mimeType: 'application/octet-stream', buffer: bytes });
}
async function save(page, panel, format, bytes, name, revision, status = 201) {
	const [response, prepared] = await Promise.all([
		page.waitForResponse(response => response.request().method() === 'POST' && (new URL(response.url()).pathname === '/api/audiocom/projects'
			|| new URL(response.url()).pathname === '/api/audiocom/projects/prepare' && response.status() !== 201)),
		page.waitForRequest(request => new URL(request.url()).pathname === '/api/audiocom/projects/prepare' && request.method() === 'POST'),
		chooseArchive(page, panel, format, bytes, name, revision),
	]);
	expect(response.status()).toBe(status);
	const query = new URL(prepared.url()).searchParams;
	expect(query.get('id')).toBe(revision?.id ?? null);
	expect(query.get('head')).toBe(revision?.snapshotId ?? null);
	if (status !== 201) return;
	await expect(archives(panel).getByText(`Stored ${name}.${format}.`, { exact: true })).toBeVisible();
	const listed = await browserRequest(page, '/api/audiocom/projects?page=1');
	expect(listed.status).toBe(200);
	const project = listed.body.data.results.find(item => revision ? item.id === revision.id : item.name === name);
	expect(project).toBeTruthy();
	if (revision) { expect(project.id).toBe(revision.id); expect(project.snapshotId).not.toBe(revision.snapshotId); }
	return project;
}
async function refresh(panel) {
	const section = archives(panel);
	if (!await section.evaluate(element => element.open)) await section.locator('summary').click();
	await section.getByRole('button', { name: 'Refresh projects', exact: true }).click();
	await expect(section.getByRole('button', { name: 'Refresh projects', exact: true })).toBeEnabled();
}
async function download(page, project) {
	const response = await browserRequest(page, `/api/audiocom/projects/download?${new URLSearchParams({ id: project.id, snapshotId: project.snapshotId })}`, true);
	expect(response.status).toBe(200);
	return Buffer.from(response.body);
}
async function browserRequest(page, path, binary = false) {
	return page.evaluate(async ({ path, origin, binary }) => {
		const response = await fetch(path, { credentials: 'include', headers: { 'X-Audiocom-Api-Origin': origin } });
		return { status: response.status, body: binary ? Array.from(new Uint8Array(await response.arrayBuffer())) : await response.json() };
	}, { path, origin: providerOrigin, binary });
}
async function openArchive(page, editor, format, bytes, revision) {
	const chooser = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await chooser).setFiles({ name: `revision-${revision}.${format}`, mimeType: 'application/x-audacity-project', buffer: bytes });
	await expect(editor.locator('[data-status]')).toContainText('Audacity project opened', { timeout: 30_000 });
	await expect(editor).toHaveAttribute('data-track-count', format === 'aup3' ? '1' : '2');
	await expect(editor).toHaveAttribute('data-clip-count', format === 'aup3' ? '1' : '5');
	await expect(trackNameText(editor).filter({ hasText: `Revision ${revision}` })).toHaveCount(1);
}
async function setFault(request, mode) {
	const response = await request.post(`${providerOrigin}/__test/archive-transfer`, { headers: { 'X-Audiocity-Test-Control': '1' }, data: { mode } });
	expect(response.status()).toBe(200);
}
async function faultState(request) {
	const response = await request.get(`${providerOrigin}/__test/archive-transfer`, { headers: { 'X-Audiocity-Test-Control': '1' } });
	expect(response.status()).toBe(200);
	return response.json();
}
async function providerApi(request) {
	const login = await request.post(`${providerOrigin}/auth/token`, { data: {
		grant_type: 'password', username: 'soundscaper-validation@example.test', password: 'soundscaper-audiocity-test-only-password', scope: 'projects',
	} });
	expect(login.status()).toBe(200);
	const headers = { Authorization: `Bearer ${(await login.json()).access_token}` };
	const get = async path => {
		const response = await request.get(`${providerOrigin}${path}`, { headers }); expect(response.status()).toBe(200); return response.json();
	};
	return { get, history: id => get(`/project/${id}/snapshot?per-page=100`), async saveRevision(project, format, bytes) {
		const created = await request.post(`${providerOrigin}/project/${project.id}/snapshot`, { headers, data: { format, size: bytes.length, head_snapshot_id: project.snapshotId } });
		expect(created.status()).toBe(201);
		const policy = await created.json();
		expect((await request.put(policy.sync.file.url, { data: bytes, headers: { 'Content-Type': 'application/octet-stream' } })).status()).toBe(200);
		expect((await request.post(policy.sync.file.success)).status()).toBe(200);
		expect((await request.post(`${providerOrigin}/project/${project.id}/snapshot/${policy.snapshot.id}/sync`, { headers })).status()).toBe(200);
		return policy;
	} };
}
