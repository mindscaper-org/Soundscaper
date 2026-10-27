#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MOTION_DESKTOP_QUALIFICATIONS } from './lib/motionscaper-desktop-qualification-contract.ts';
import { main as desktopMain } from './motionscaper-desktop-qualification.ts';

export const MOTION_LINUX_QUALIFICATIONS = MOTION_DESKTOP_QUALIFICATIONS;
export { motionQualificationReceipts } from './lib/motionscaper-desktop-qualification-contract.ts';

export async function main(args = process.argv.slice(2)): Promise<void> {
	if (process.platform !== 'linux') throw new Error('Linux qualification requires its native Linux target and X11.');
	await desktopMain(args);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
