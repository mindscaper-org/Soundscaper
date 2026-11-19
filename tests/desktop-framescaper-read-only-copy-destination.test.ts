/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { link, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { IPC } from '../desktop/constants.js';
import { ReadCapabilityStore } from '../desktop/file-capabilities.js';
import { registerFileCapabilityIpc } from '../desktop/main-file-capability-ipc.mjs';
import { OriginalFileOverwriteStore } from '../desktop/original-file-overwrite.ts';
import { createProtocolHandler } from '../desktop/protocol.js';
import { createSaveTargetPreload } from '../desktop/save-target-preload.ts';
import { AtomicSaveManager, SaveTargetStore } from '../desktop/save-targets.js';
import { acceptsFile } from '../desktop/validation.js';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import type { ScapeArchiveByteSource } from '../src/common/scape/archive-byte-source.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { startFramescaperDesktopProjectSession } from './helpers/framescaper-desktop-project-session.ts';
import { openFramescaperImageFixtureLibrary } from './helpers/framescaper-portable-timeline-image.ts';
import { rewriteScapeProjectDocument } from './helpers/scape-archive-rewrite.js';

test('desktop Save Project Copy protects its original after atomic replacement and allows an independent destination', async context => {
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-read-only-copy-'));
	context.after(async () => rm(directory, { recursive: true, force: true }));
	const original = join(directory, 'Session.fscape');
	const replacement = join(directory, 'replacement.fscape');
	const { older, newer } = await writeFutureArchives(original, replacement);
	const native = createDesktopFileFixture(directory, original);
	const { fileService } = native;
	try {
		const { controller, close } = await startFramescaperDesktopProjectSession(directory, { presentation: { locale: 'en', fileService } });
		try {
			const [descriptor] = await fileService.chooseFiles({ purpose: 'project' });
			assert.ok(descriptor);
			await fileService.withScapeReadDescriptor(descriptor, {}, (source: ScapeArchiveByteSource) => (
				controller.actions.project.openScapeFile(source, () => 'open-read-only')
			));
			assert.equal(controller.project?.title, 'Earlier archive revision');
			assert.equal(controller.getSnapshot().readOnly, true);
			const earlierAlias = join(directory, 'Earlier hard link.fscape');
			const earlierLink = await createHardLink(original, earlierAlias);
			await rename(replacement, original);
			const laterAlias = join(directory, 'Later hard link.fscape');
			const laterLink = await createHardLink(original, laterAlias);
			const laterInode = await stat(original, { bigint: true });
			const protectedPaths = [original, ...(earlierLink ? [earlierAlias] : []), ...(laterLink ? [laterAlias] : [])];
			for (const selected of protectedPaths) {
				native.select(selected);
				await assert.rejects(controller.actions.project.saveScape({ saveCopy: true }), /original project is protected/u);
			}
			assert.equal((await stat(original, { bigint: true })).ino, laterInode.ino);
			assert.equal((await readFile(original)).equals(newer), true);
			if (earlierLink) assert.equal((await readFile(earlierAlias)).equals(older), true);
			if (laterLink) assert.equal((await readFile(laterAlias)).equals(newer), true);
			if (laterLink) {
				const lateAlias = join(directory, 'Late hard link.fscape');
				native.select(lateAlias);
				native.addAliasBeforeCommit(lateAlias);
				await assert.rejects(controller.actions.project.saveScape({ saveCopy: true }), (error: unknown) => (
					error instanceof Error && error.cause instanceof Error && /original project is protected/u.test(error.cause.message)
				));
				assert.equal((await stat(lateAlias, { bigint: true })).ino, laterInode.ino);
				assert.equal((await readFile(lateAlias)).equals(newer), true);
			}
			const picked = join(directory, 'Independent copy.fscape');
			await writeFile(picked, newer);
			native.select(picked);
			await controller.actions.project.saveScape({ saveCopy: true });
			assert.equal((await readFile(picked)).equals(older), true);
			assert.equal((await readFile(original)).equals(newer), true);
			assert.equal(controller.getSnapshot().readOnly, true);
			assert.ok(native.copySourceId);
			await assert.rejects(native.prepareOriginalOverwrite(native.copySourceId), /Original file overwrite is unavailable/u);
		} finally { await close(); }
		assert.ok(native.copySourceId && native.released.has(native.copySourceId));
	} finally { await native.close(); }
});

async function writeFutureArchives(original: string, replacement: string) {
	const authored = await openFramescaperImageFixtureLibrary();
	try {
		const archives = createFramescaperScapeNativeRuntime(PROFILE);
		async function saveFuture(path: string, title: string) {
			const project = createFramescaperProject(PROFILE, { id: 'future-session', title, now: '2026-11-19T00:00:00.000Z' });
			const exported = await archives.exportScapeProject(project, authored.store);
			assert.ok(exported.blob);
			const opaque = await rewriteScapeProjectDocument(exported.blob, (document: { schemaVersion: number }) => { document.schemaVersion = 2; });
			const bytes = new Uint8Array(await opaque.arrayBuffer());
			await writeFile(path, bytes);
			return bytes;
		}
		const older = await saveFuture(original, 'Earlier archive revision');
		const newer = await saveFuture(replacement, 'Later archive revision');
		return { older, newer };
	} finally { await authored.close(); }
}

async function createHardLink(path: string, alias: string): Promise<boolean> {
	try { await link(path, alias); return true; }
	catch (error) {
		if (!['ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EPERM'].includes(String((error as NodeJS.ErrnoException).code))) throw error;
		return false;
	}
}

function createDesktopFileFixture(directory: string, original: string) {
	const owner = {};
	const reads = new ReadCapabilityStore();
	const targets = new SaveTargetStore();
	const saves = new AtomicSaveManager({ targets });
	const originals = new OriginalFileOverwriteStore({ reads, targets, acceptsFile, cleanDisplayName: value => value, maximumCount: 10 });
	const handlers = new Map<string, (event: object, value: unknown) => unknown>();
	const released = new Set<string>();
	let selected = original;
	let copySourceId: string | null = null;
	let lateAlias: string | null = null;
	registerFileCapabilityIpc({
		channels: IPC, desktopSmokeProbe: { resolveOpenPaths: () => null, resolveSavePath: async () => null },
		dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [original] }),
			showSaveDialog: async () => ({ canceled: false, filePath: selected }) },
		handle: (channel: string, handler: (event: object, value: unknown) => unknown) => { handlers.set(channel, handler); },
		opaqueId: (value: unknown) => String(value), ownerFor: () => owner, pendingOpenProjects: { dispatch: async () => undefined },
		readCapabilities: reads, saves, saveTargets: targets, originalFiles: originals, windowFor: () => null,
	});
	const protocol = createProtocolHandler({ productId: 'framescaper', rendererRoot: directory, runtimeRoot: directory, readCapabilities: reads });
	async function invoke(channel: string, value: unknown) {
		const handler = handlers.get(channel);
		assert.ok(handler);
		if (channel === IPC.finishWrite && lateAlias) {
			await link(original, lateAlias);
			lateAlias = null;
		}
		const result = await handler({}, value);
		if (channel === IPC.chooseSaveTarget && typeof result === 'string') copySourceId = result;
		if (channel === IPC.releaseOriginalFile && typeof value === 'string' && result === true) released.add(value);
		return result;
	}
	const preload = createSaveTargetPreload({ invoke, channel: IPC.chooseSaveTarget,
		text(value, maximum) { assert.ok(typeof value === 'string' && value.length <= maximum); return value; } });
	const methods = ['chooseFiles', 'releaseRead', 'releaseOriginalFile', 'releaseSaveTarget',
		'beginWrite', 'writeChunk', 'patchFinalPrefix', 'finishWrite', 'abortWrite'] as const;
	const bridge = { ...Object.fromEntries(methods.map(method => [method, (value: unknown) => invoke(IPC[method], value)])),
		chooseSaveTarget: preload.chooseSaveTarget };
	const fileService = createAudioEditorFileService({ bridge, fetch: (url: string, options: RequestInit) => protocol(new Request(url, options)) });
	return { fileService, released, get copySourceId() { return copySourceId; },
		select(path: string) { selected = path; }, addAliasBeforeCommit(path: string) { lateAlias = path; },
		prepareOriginalOverwrite: (id: string) => originals.prepare(id, { owner }),
		close: async () => { originals.dispose(); targets.dispose(); await Promise.all([reads.dispose(), saves.dispose()]); },
	};
}
