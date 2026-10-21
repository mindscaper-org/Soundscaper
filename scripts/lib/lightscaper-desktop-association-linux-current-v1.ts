/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { associationReadCurrentV1 as read, associationToolCurrentV1 as tool, associationFileCurrentV1 as file } from './lightscaper-desktop-association-evidence-current-v1.ts';
import type { LightscaperAssociationProcessOwnerCurrentV1 } from './lightscaper-desktop-association-evidence-current-v1.ts';

const MIME = 'application/vnd.lightscaper.liscape+zip', FOREIGN_MIME = 'application/vnd.soundscaper.scape+zip';
const DESKTOP_ID = 'org.lightscaper.desktop';
export function readLightscaperLinuxAssociationMetadataCurrentV1(desktop: string, xml: string, executable: string) {
	if (desktop.length > 65536 || xml.length > 65536 || /\0|\r/u.test(desktop) || /<!/u.test(xml)) throw new TypeError('Installed association metadata is not bounded plain builder metadata.');
	const fields = new Map<string, string>(); let section = '';
	for (const line of desktop.split('\n')) {
		if (!line || line.startsWith('#')) continue;
		if (line.startsWith('[')) { if (line !== '[Desktop Entry]' || section) throw new Error('Unexpected desktop section.'); section = line; continue; }
		const at = line.indexOf('='); if (section !== '[Desktop Entry]' || at < 1) throw new Error('Invalid installed desktop field.');
		const key = line.slice(0, at); if (fields.has(key)) throw new Error('Duplicate desktop metadata field.'); fields.set(key, line.slice(at + 1));
	}
	const quoted = /^[/0-9A-Za-z._-]+$/u.test(executable) ? executable : `"${executable}"`;
	if (fields.get('Type') !== 'Application' || fields.get('Name') !== 'Lightscaper' || fields.get('Exec') !== `${quoted} %U`
		|| fields.get('MimeType') !== `${MIME};` || fields.has('DBusActivatable') || fields.has('TryExec')) throw new Error('Installed Lightscaper desktop identity, default Exec or exact owned MIME differs.');
	const types = [...xml.matchAll(/<mime-type\s+type="([^"]+)"\s*>/gu)].map(match => match[1]);
	const globs = [...xml.matchAll(/<glob\s+pattern="([^"]+)"\s*\/\s*>/gu)].map(match => match[1]);
	if (types.length !== 1 || types[0] !== MIME || globs.length !== 1 || globs[0] !== '*.liscape'
		|| /<alias\b|<sub-class-of\b|<magic\b/u.test(xml) || xml.includes(FOREIGN_MIME)) throw new Error('Installed MIME XML claims more than the one owned catalog suffix.');
	return Object.freeze({ desktopId: DESKTOP_ID, mimeType: MIME, extension: 'liscape', exec: fields.get('Exec')! });
}

/** Private XDG registration copies the real installed metadata without changing
 * Exec. The Debian installer is qualified separately; this is actual user
 * default routing in a fresh owned environment, not global host mutation. */
export async function createLightscaperLinuxAssociationEnvironmentCurrentV1(options: Readonly<{
	ownerRoot: string; executablePath: string; processOwner: LightscaperAssociationProcessOwnerCurrentV1;
}>) {
	if (process.platform !== 'linux') throw new Error('Linux XDG association owner requires a native Linux host.');
	const root = join(options.ownerRoot, 'xdg'); await mkdir(root, { mode: 0o700 });
	if (await realpath(root) !== root) throw new Error('Private XDG root changed.');
	const previous = new Map<string, string | undefined>();
	let closed = false;
	try {
	for (const [name, child] of [['XDG_CONFIG_HOME', 'config'], ['XDG_DATA_HOME', 'data'], ['XDG_CACHE_HOME', 'cache'], ['XDG_STATE_HOME', 'state']] as const) {
		const path = join(root, child); await mkdir(path, { mode: 0o700 }); previous.set(name, process.env[name]); process.env[name] = path;
	}
		const data = join(root, 'data'), applications = join(data, 'applications'), packages = join(data, 'mime/packages');
		await mkdir(applications, { mode: 0o700 }); await mkdir(packages, { recursive: true, mode: 0o700 });
		const desktopSource = '/usr/share/applications/' + DESKTOP_ID, mimeSource = '/usr/share/mime/packages/lightscaper.xml';
		const desktop = await read(desktopSource, 65536), xml = await read(mimeSource, 65536);
		const metadata = readLightscaperLinuxAssociationMetadataCurrentV1(desktop.toString('utf8'), xml.toString('utf8'), options.executablePath);
		const desktopFile = join(applications, DESKTOP_ID), mimeFile = join(packages, 'lightscaper.xml');
		await writeFile(desktopFile, desktop, { flag: 'wx', mode: 0o600 }); await writeFile(mimeFile, xml, { flag: 'wx', mode: 0o600 });
		if (!(await readFile(desktopFile)).equals(desktop) || !(await readFile(mimeFile)).equals(xml)) throw new Error('Private registration changed installed handler metadata bytes.');
		const xdg = await tool('xdg-mime');
		const query = async (type: string): Promise<string> => (await options.processOwner.run(xdg, ['query', 'default', type], { deadlineMs: 15_000 })).stdout.trim();
		const foreignBefore = await query(FOREIGN_MIME), defaultBefore = await query(MIME);
		if (defaultBefore && defaultBefore !== DESKTOP_ID) throw new Error('An actual foreign default handler exists; no override is authorized.');
		await options.processOwner.run(await tool('update-mime-database'), [join(data, 'mime')], { deadlineMs: 15_000 });
		await options.processOwner.run(await tool('update-desktop-database'), [applications], { deadlineMs: 15_000 });
		await options.processOwner.run(xdg, ['default', DESKTOP_ID, MIME], { deadlineMs: 15_000 });
		const defaultAfter = await query(MIME);
		if (defaultAfter !== DESKTOP_ID || await query(FOREIGN_MIME) !== foreignBefore) throw new Error('Actual default registration/foreign MIME preservation is incomplete.');
		return Object.freeze({ profilePath: join(root, 'config/Lightscaper'), desktopFile,
			async register(archivePath: string): Promise<unknown> {
				const contentType = (await options.processOwner.run(xdg, ['query', 'filetype', archivePath], { deadlineMs: 15_000 })).stdout.trim();
				if (contentType !== MIME || await query(MIME) !== DESKTOP_ID) throw new Error('The actual archive does not resolve to the registered owned default.');
				return Object.freeze({ kind: 'actual-private-xdg-installed-debian-registration', metadata, desktopSource: await file(desktopSource, 65536),
					mimeSource: await file(mimeSource, 65536), desktopFile: await file(desktopFile, 65536), mimeFile: await file(mimeFile, 65536),
					defaultBefore, defaultAfter, foreignMime: FOREIGN_MIME, foreignBefore, contentType });
			},
			async close(readersRetired: boolean): Promise<void> {
				if (closed) return;
				if (!readersRetired || !options.processOwner.readersRetired) throw new Error('Actual Linux association consumers remain unretired.');
				if (await query(FOREIGN_MIME) !== foreignBefore) throw new Error('Foreign MIME default changed; retaining owned XDG diagnostics.');
				await rm(root, { recursive: true }); closed = true;
			},
			restoreEnvironment() { for (const [name, value] of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } },
		});
	} catch (error) {
		for (const [name, value] of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
		throw error;
	}
}
