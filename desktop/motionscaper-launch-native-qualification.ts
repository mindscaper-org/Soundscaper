/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect } from '@playwright/test';
import { verifyMotionscaperDesktopStage, verifyMotionscaperPackagedResources } from '../scripts/lib/motionscaper-desktop-package.mjs';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { exportMotionscaperArchive, importMotionscaperArchive } from '../src/motionscaper/editor-scape.ts';
import { createMotionscaperOpaqueArchive } from '../scripts/lib/motionscaper-qualification-opaque-archive.ts';
import { resolveMotionQualificationPaths } from './motionscaper-native-qualification-paths.ts';
import { motionQualificationTarget, requireMotionQualificationHost } from './motionscaper-qualification-platform.ts';
import { launchMotionQualificationApplication, runMotionQualificationCommand } from './motionscaper-qualification-session.ts';

/** External packaged-app qualification: OS arguments and public UI only. No injected bridge. */
export async function qualifyMotionscaperNativeLaunch(): Promise<void> {
	if (process.argv.length !== 2) throw new Error('Packaged launch qualification accepts no arguments.');
	const target = motionQualificationTarget(); requireMotionQualificationHost(target);
	const root = resolve(import.meta.dirname, '..');
	const selected = resolveMotionQualificationPaths(root, 'motionscaper', process.arch);
	const executable = selected.executable; await access(executable);
	const stage = await verifyMotionscaperDesktopStage(selected.stage, target);
	await verifyMotionscaperPackagedResources(selected.resources, stage);
	const sourceRevision: unknown = stage.sourceRevision; assert.equal(typeof sourceRevision, 'string'); assert.match(String(sourceRevision), /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);
	const temporary = await mkdtemp(join(tmpdir(), 'motionscaper-native-launch-'));
	const paths = { cold: join(temporary, 'cold.mscape'), warm: join(temporary, 'warm.scape'), future: join(temporary, 'future.scape'), last: join(temporary, 'last.mscape') };
	const archive = async (path: string, id: string, title: string) => {
		const blob = await exportMotionscaperArchive(createMotionscaperProject({ id, title, compositionId: 'comp', width: 32, height: 32, durationFrames: 2 }), () => null);
		assert.ok(blob); await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
	};
	await archive(paths.cold, 'native-original', 'Cold original'); await archive(paths.warm, 'native-original', 'Warm incoming'); await archive(paths.last, 'native-last', 'Last launched project');
	const future = await createMotionscaperOpaqueArchive('motionscaper', 2); await writeFile(paths.future, new Uint8Array(await future.arrayBuffer()));
	const hash = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex');
	const warmDigest = await hash(paths.warm), futureDigest = await hash(paths.future), coldDigest = await hash(paths.cold);
	const env: NodeJS.ProcessEnv = { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', SCAPE_PRODUCT: 'motionscaper' }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
	const profile = `--user-data-dir=${join(temporary, 'profile')}`;
	const application = await launchMotionQualificationApplication({ executable, cwd: root, directory: temporary, args: [paths.cold], env, workflow: 'launch', timeoutMs: 120000 });
	let warmIndex = 0;
	try {
		const { page } = application;
		await expect(page.locator('[data-motion-project-title]')).toHaveText('Cold original', { timeout: 20000 });
		assert.ok(page.url().startsWith('motionscaper-app://bundle/')); await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device');
		const menu = async (top: string, label: string) => { await page.getByRole('menuitem', { name: top, exact: true }).click(); await page.getByRole('menuitem', { name: label, exact: true }).click(); };
		const warm = async (path: string) => { await runMotionQualificationCommand({ command: executable, args: ['--disable-gpu', profile, path], cwd: root, directory: temporary, id: `warm-${++warmIndex}`, env, timeoutMs: 20000 }); };
		await menu('View', 'Composition Settings'); let settings = page.getByRole('dialog', { name: 'Composition Settings', exact: true });
		await settings.getByLabel('Project title', { exact: true }).fill('Cold saved through native binding'); await settings.getByRole('button', { name: 'Apply', exact: true }).click();
		await menu('File', 'Save'); await expect.poll(() => hash(paths.cold)).not.toBe(coldDigest);
		const saved = await importMotionscaperArchive(new Blob([new Uint8Array(await readFile(paths.cold))]), () => ({ writeAssetChunk: () => Promise.resolve(), finishAsset: () => Promise.resolve(), commit: () => Promise.resolve(), rollback: () => Promise.resolve() }));
		assert.equal(saved.kind, 'current'); if (saved.kind !== 'current') throw new Error('Saved current archive became opaque.'); assert.equal(saved.project.title, 'Cold saved through native binding');
		await menu('View', 'Composition Settings'); settings = page.getByRole('dialog', { name: 'Composition Settings', exact: true });
		await settings.getByLabel('Project title', { exact: true }).fill('Protected authored draft'); await warm(paths.warm); await expect(settings).toBeVisible();
		await settings.getByRole('button', { name: 'Apply', exact: true }).click();
		const review = page.getByRole('dialog', { name: 'Open Project Conflict', exact: true }); await expect(review).toBeVisible();
		await warm(paths.future); await warm(paths.last); await expect(review).toBeVisible();
		await review.getByRole('button', { name: 'Import Independent Copy', exact: true }).click();
		const opaque = page.getByRole('dialog', { name: 'Read-only archive', exact: true }); await expect(opaque).toBeVisible();
		await expect(page.locator('[data-motion-project-title]')).toHaveText('Warm incoming');
		// Main revokes the old document's capability and requeues it ahead of the waiting file.
		await page.reload(); await expect(opaque).toBeVisible({ timeout: 20000 }); await page.keyboard.press('Escape');
		await expect(page.locator('[data-motion-project-title]')).toHaveText('Last launched project');
		await menu('File', 'Project Library'); const library = page.getByRole('dialog', { name: 'Project Library', exact: true });
		await expect(library.getByRole('button', { name: 'Warm incoming', exact: true })).toBeVisible();
		await expect(library.getByRole('button', { name: 'Cold saved through native binding', exact: true })).toBeVisible();
		assert.equal(await hash(paths.warm), warmDigest, 'Import Copy modified its original archive.'); assert.equal(await hash(paths.future), futureDigest, 'Opaque custody modified its archive.');
		console.log(`MOTIONSCAPER_NATIVE_LAUNCH_QUALIFIED ${JSON.stringify({ platform: process.platform, arch: process.arch, sourceRevision, ownOrigin: page.url(), coldLaunch: true, originalFileSave: true, warmSecondInstance: true, legacyScape: true, protectedAuthoring: true, independentCopy: true, queuedOpaque: true, rendererReload: true, orderedCompletion: true, originalArchivesUnchanged: true, gpuMode: 'software (--disable-gpu)' })}`);
	} finally { await application.cleanup(); await rm(temporary, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }); }
}
