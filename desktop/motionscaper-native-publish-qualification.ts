/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { verifyMotionscaperDesktopStage, verifyMotionscaperPackagedResources } from '../scripts/lib/motionscaper-desktop-package.mjs';
import { importMotionscaperArchive } from '../src/motionscaper/editor-scape.ts';
import { createMotionscaperRevision } from '../src/motionscaper/editor-project-revision.ts';
import { motionQualificationTarget } from './motionscaper-qualification-platform.ts';
import { resolveMotionQualificationPaths } from './motionscaper-native-qualification-paths.ts';
import { launchMotionQualificationApplication } from './motionscaper-qualification-session.ts';

/** A normal File Save by the actual Motion publisher is the watched replacement producer. */
export async function publishMotionQualificationRevision(root: string, archive: string, directory: string, sourceRevision: string) {
	const paths = resolveMotionQualificationPaths(root, 'motionscaper', process.arch), target = motionQualificationTarget();
	const stage = await verifyMotionscaperDesktopStage(paths.stage, target); assert.equal(stage.sourceRevision, sourceRevision);
	await verifyMotionscaperPackagedResources(paths.resources, stage);
	await mkdir(directory, { mode: 0o700 });
	const before = createHash('sha256').update(await readFile(archive)).digest('hex');
	const application = await launchMotionQualificationApplication({ executable: paths.executable, cwd: root, directory,
		args: [archive], workflow: 'launch', timeoutMs: 90000 });
	try {
		const { page } = application;
		await expect(page.locator('[data-motion-project-title]')).toHaveText('Native first', { timeout: 30000 });
		const menu = async (top: string, item: string) => { await page.getByRole('menuitem', { name: top, exact: true }).click(); await page.getByRole('menuitem', { name: item, exact: true }).click(); };
		await menu('View', 'Composition Settings'); const settings = page.getByRole('dialog', { name: 'Composition Settings', exact: true });
		await settings.getByLabel('Project title', { exact: true }).fill('Native revision 1');
		await settings.getByRole('button', { name: 'Apply', exact: true }).click();
		await menu('File', 'Save');
		await expect.poll(async () => createHash('sha256').update(await readFile(archive)).digest('hex')).not.toBe(before);
		await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device', { timeout: 30000 });
		const loaded = await importMotionscaperArchive(new Blob([new Uint8Array(await readFile(archive))]), () => ({
			writeAssetChunk: () => Promise.resolve(), finishAsset: () => Promise.resolve(), commit: () => Promise.resolve(), rollback: () => Promise.resolve(),
		}));
		assert.equal(loaded.kind, 'current'); if (loaded.kind !== 'current') throw new Error('Native publisher Save produced an opaque archive.');
		assert.equal(loaded.project.title, 'Native revision 1'); return createMotionscaperRevision(loaded.project);
	} finally { await application.cleanup(); }
}
