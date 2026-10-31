/* SPDX-License-Identifier: AGPL-3.0-only */

import { writeFile } from 'node:fs/promises';
import { deflateSync, gzipSync } from 'node:zlib';

/** A real XAR product archive with a gzip-compressed CPIO payload, without Apple build tools. */
export async function writeDesktopPkgFixture(path: string, options: {
	readonly installLocation?: string;
	readonly optionalPayload?: boolean;
	readonly extraComponent?: boolean;
	readonly symlinkTarget?: string;
	readonly payloadEscape?: boolean;
} = {}): Promise<void> {
	const application = 'org.soundscaper.desktop.pkg';
	const optional = 'org.soundscaper.desktop.ffmpeg.pkg';
	const cpioEntries: Array<readonly [string, number, string]> = [
		['.', 0o040755, ''],
		['./Soundscaper.app', 0o040755, ''],
		['Soundscaper.app/Contents', 0o040755, ''],
		['Soundscaper.app/Contents/MacOS', 0o040755, ''],
		['Soundscaper.app/Contents/MacOS/Soundscaper', 0o100755, 'application fixture'],
		['Soundscaper.app/current', 0o120777, options.symlinkTarget ?? 'Contents'],
	];
	if (options.payloadEscape) cpioEntries.push(['../outside', 0o100644, 'escape']);
	const payload = gzipSync(cpioArchive(cpioEntries));
	const files: Array<readonly [string, Buffer]> = [
		['Distribution', Buffer.from('<installer-gui-script/>')],
		[`${application}/PackageInfo`, Buffer.from(`<pkg-info identifier="org.soundscaper.desktop" install-location="${options.installLocation ?? '/Applications'}"/>`)],
		[`${application}/Payload`, payload],
		[`${application}/Bom`, Buffer.from('bom fixture')],
		[`${optional}/PackageInfo`, Buffer.from('<pkg-info identifier="org.soundscaper.desktop.ffmpeg"/>')],
		[`${optional}/Scripts`, gzipSync(cpioArchive([['postinstall', 0o100755, '#!/bin/sh\nexit 99\n']]))],
	];
	if (options.optionalPayload) files.push([`${optional}/Payload`, payload]);
	if (options.extraComponent) files.push(['foreign.pkg/PackageInfo', Buffer.from('<pkg-info/>')]);
	const directories = new Set(files.flatMap(([name]) => name.includes('/') ? [name.slice(0, name.indexOf('/'))] : []));
	let nextId = 1;
	let offset = 0;
	const fileXml = (name: string, contents: Buffer): string => {
		const xml = `<file id="${nextId++}"><name>${name}</name><type>file</type><mode>0644</mode><data><length>${contents.length}</length><offset>${offset}</offset><size>${contents.length}</size><encoding style="application/octet-stream"/></data></file>`;
		offset += contents.length;
		return xml;
	};
	const chunks: Buffer[] = [];
	const record = (name: string, contents: Buffer): string => { chunks.push(contents); return fileXml(name, contents); };
	const records = files.filter(([name]) => !name.includes('/')).map(([name, contents]) => record(name, contents));
	for (const directory of directories) {
		const id = nextId++;
		const children = files.filter(([name]) => name.startsWith(`${directory}/`))
			.map(([name, contents]) => record(name.slice(directory.length + 1), contents)).join('');
		records.push(`<file id="${id}"><name>${directory}</name><type>directory</type><mode>0755</mode>${children}</file>`);
	}
	const toc = Buffer.from(`<?xml version="1.0"?><xar><toc>${records.join('')}</toc></xar>`);
	const compressedToc = deflateSync(toc);
	const header = Buffer.alloc(28);
	header.write('xar!'); header.writeUInt16BE(28, 4); header.writeUInt16BE(1, 6);
	header.writeBigUInt64BE(BigInt(compressedToc.length), 8);
	header.writeBigUInt64BE(BigInt(toc.length), 16);
	await writeFile(path, Buffer.concat([header, compressedToc, ...chunks]));
}

function cpioArchive(entries: readonly (readonly [string, number, string])[]): Buffer {
	const chunks: Buffer[] = [];
	let index = 1;
	for (const [name, mode, data] of [...entries, ['TRAILER!!!', 0, ''] as const]) {
		const filename = Buffer.from(`${name}\0`);
		const contents = Buffer.from(data);
		const fields = [index++, mode, 0, 0, 1, 0, contents.length, 0, 0, 0, 0, filename.length, 0];
		const header = Buffer.from(`070701${fields.map(value => value.toString(16).padStart(8, '0')).join('')}`);
		chunks.push(header, filename, Buffer.alloc((4 - (header.length + filename.length) % 4) % 4),
			contents, Buffer.alloc((4 - contents.length % 4) % 4));
	}
	return Buffer.concat(chunks);
}
