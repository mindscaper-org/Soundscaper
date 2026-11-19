/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { IPC } from '../desktop/constants.js';
import { ReadCapabilityStore } from '../desktop/file-capabilities.js';
import { registerFileCapabilityIpc } from '../desktop/main-file-capability-ipc.mjs';
import { OriginalFileOverwriteStore } from '../desktop/original-file-overwrite.ts';
import { createProtocolHandler } from '../desktop/protocol.js';
import { createSaveTargetPreload } from '../desktop/save-target-preload.ts';
import { AtomicSaveManager, SaveTargetStore } from '../desktop/save-targets.js';
import { acceptsFile } from '../desktop/validation.js';
import { createCrossProductHandoffLaunchIntent } from '../src/common/cross-product-handoff-intent.ts';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import type { ScapeArchiveByteSource } from '../src/common/scape/archive-byte-source.ts';
import { admitCrossProductHandoffReportSidecar, crossProductHandoffReportSidecarFileName } from '../src/common/transfer/cross-product-handoff-report-sidecar.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperEphemeralProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { startFramescaperDesktopProjectSession } from './helpers/framescaper-desktop-project-session.ts';
import { openFramescaperImageFixtureLibrary } from './helpers/framescaper-portable-timeline-image.ts';

test('desktop Edit in Soundscaper preserves an independently revised destination archive', async () => {
	const root = await mkdtemp(join(tmpdir(), 'scape-cross-product-copy-destination-'));
	const sourcePath = join(root, 'source.fscape');
	const destination = join(root, 'destination.sscape');
	const replacement = join(root, 'external.sscape');
	const reportName = crossProductHandoffReportSidecarFileName(basename(destination));
	const reads = new ReadCapabilityStore();
	const targets = new SaveTargetStore();
	const saves = new AtomicSaveManager({ targets });
	const originals = new OriginalFileOverwriteStore({ reads, targets, acceptsFile, cleanDisplayName: value => value, maximumCount: 10 });
	const soundStore = createSoundscaperEphemeralProjectStore();
	const soundArchives = createSoundscaperScapeNativeRuntime();
	const owner = {}, handlers = new Map<string, (event: object, value: unknown) => unknown>();
	const dialogTitles: string[] = [];
	let selected = destination;
	let replaceDuringWrite = true;
	let replacementInode: bigint | null = null;
	try {
		const authored = await openFramescaperImageFixtureLibrary();
		try {
			const { blob } = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(
				createFramescaperProject(PROFILE, { id: 'frames-source', title: 'Framescaper edit' }), authored.store,
			);
			assert.ok(blob);
			await writeFile(sourcePath, new Uint8Array(await blob.arrayBuffer()));
		} finally { await authored.close(); }
		const earlier = await authorSoundArchive(destination, 'Earlier destination revision');
		const later = await authorSoundArchive(replacement, 'Later destination revision');
		assert.ok(!earlier.equals(later));

		registerFileCapabilityIpc({
			channels: IPC, desktopSmokeProbe: { resolveOpenPaths: () => null, resolveSavePath: async () => null },
			dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [sourcePath] }),
				async showSaveDialog(_window: unknown, options: { title: string }) {
					dialogTitles.push(options.title);
					const path = options.title === 'Save project copy' ? selected
						: join(root, crossProductHandoffReportSidecarFileName(basename(selected)));
					return { canceled: false, filePath: path };
				} },
			handle: (channel: string, handler: (event: object, value: unknown) => unknown) => { handlers.set(channel, handler); },
			opaqueId: String, ownerFor: () => owner, pendingOpenProjects: { dispatch: async () => undefined },
			readCapabilities: reads, saves, saveTargets: targets, originalFiles: originals, windowFor: () => null,
		});
		async function invoke(channel: string, value: unknown) {
			const handler = handlers.get(channel);
			assert.ok(handler);
			if (channel === IPC.finishWrite && replaceDuringWrite) {
				replaceDuringWrite = false;
				assert.ok((await readdir(root)).some(name => name.endsWith('.soundscaper-part')));
				await rename(replacement, destination);
				replacementInode = (await stat(destination, { bigint: true })).ino;
			}
			const reply = await handler({}, value);
			if (channel === IPC.chooseSaveTarget && reply && typeof reply === 'object') {
				assert.equal(Object.hasOwn(reply, 'originalFile'), false);
			}
			return reply;
		}
		const { chooseSaveTarget } = createSaveTargetPreload({ invoke, channel: IPC.chooseSaveTarget,
			text(value, maximum) { assert.ok(typeof value === 'string' && value.length <= maximum); return value; } });
		const methods = ['chooseFiles', 'releaseRead', 'releaseOriginalFile', 'releaseSaveTarget',
			'beginWrite', 'writeChunk', 'finishWrite', 'abortWrite'] as const;
		const protocol = createProtocolHandler({ productId: 'framescaper', rendererRoot: root, runtimeRoot: root, readCapabilities: reads });
		const fileService = createAudioEditorFileService({ bridge: {
			...Object.fromEntries(methods.map(method => [method, (value: unknown) => invoke(IPC[method], value)])), chooseSaveTarget,
		}, fetch: (url: string, options: RequestInit) => protocol(new Request(url, options)) });
		const { controller, close } = await startFramescaperDesktopProjectSession(root, { presentation: { locale: 'en', fileService } });
		try {
			const [descriptor] = await fileService.chooseFiles({ purpose: 'project' });
			assert.ok(descriptor);
			await fileService.withScapeReadDescriptor(descriptor, {}, (source: ScapeArchiveByteSource) => (
				controller.actions.project.openScapeFile(source)
			));
			assert.equal(controller.project?.title, 'Framescaper edit');
			const intent = createCrossProductHandoffLaunchIntent({ sourceProject: controller.project,
				destinationFamily: 'soundscaper', invocationId: 'desktop-copy', destinationProjectId: 'converted-edit' });
			const [attempt] = await Promise.allSettled([controller.actions.project.saveCrossProductCopy(intent)]);
			const surviving = await readFile(destination);
			assert.equal((await inspect(surviving)).title, 'Later destination revision');
			assert.ok(surviving.equals(later));
			assert.equal((await stat(destination, { bigint: true })).ino, replacementInode);
			assert.equal(attempt.status, 'rejected');
			assert.match(String(attempt.reason), /selected project save destination changed/iu);
			assert.deepEqual(dialogTitles, ['Save project copy']);
			assert.ok((await readdir(root)).every(name => !name.endsWith('.soundscaper-part') && name !== reportName));

			for (const path of [destination, join(root, 'new destination.sscape')]) {
				selected = path;
				await controller.actions.project.saveCrossProductCopy(intent);
				const copied = await readFile(path);
				assert.equal((await inspect(copied)).id, intent.destination.projectId);
				const companion = crossProductHandoffReportSidecarFileName(basename(path));
				const report: unknown = JSON.parse(await readFile(join(root, companion), 'utf8'));
				assert.equal(admitCrossProductHandoffReportSidecar(report, { entryId: intent.destination.projectId, archive: copied }).entryId, intent.destination.projectId);
			}
			assert.deepEqual(dialogTitles, ['Save project copy', 'Save project copy', 'Export', 'Save project copy', 'Export']);
		} finally { await close(); }
	} finally {
		originals.dispose();
		targets.dispose();
		await Promise.all([reads.dispose(), saves.dispose(), soundStore.close()]);
		await rm(root, { recursive: true, force: true });
	}

	async function authorSoundArchive(path: string, title: string) {
		const { blob } = await soundArchives.exportScapeProject(createSoundscaperProject({ id: 'other-sound-session', title }), soundStore);
		assert.ok(blob);
		const bytes = Buffer.from(await blob.arrayBuffer());
		await writeFile(path, bytes);
		return bytes;
	}
	function inspect(bytes: Uint8Array<ArrayBuffer>) {
		return soundArchives.inspectScapeProject(new Blob([bytes]), soundStore,
			{ signal: new AbortController().signal }, { retain() {} });
	}
});
