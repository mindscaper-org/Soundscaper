/* SPDX-License-Identifier: AGPL-3.0-only */
import { execFile } from 'node:child_process';
import { copyFile, lstat, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, resolve, win32 } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { planMsiPayload } from './desktop-msi-payload.ts';

const executeFile = promisify(execFile);
/**
 * Extract embedded cabinets and rebuild the exact File/Component/Directory table layout.
 * @param {{artifact: string, extractedRoot: string, sevenZip: string, productId: string}} input
 * @param {{execute?: (command: string, args: string[], options: import('node:child_process').ExecFileOptionsWithStringEncoding) => Promise<{stdout: string, stderr: string}>}} dependencies
 */
export async function extractMsiApplication({ artifact, extractedRoot, sevenZip, productId }, dependencies = {}) {
	const execute = dependencies.execute ?? executeFile;
	if (process.platform !== 'win32' && execute === executeFile) throw new Error('Read-only MSI extraction requires Windows Installer on Windows.');
	const cabinets = `${extractedRoot}-cabinets`;
	const rawRoot = `${extractedRoot}-cabinet-files`;
	/** @type {import('node:child_process').ExecFileOptionsWithStringEncoding} */
	const options = { timeout: 5 * 60_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true, encoding: 'utf8' };
	const powershell = win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
	const metadata = await execute(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File',
		fileURLToPath(new URL('../read-windows-msi-payload.ps1', import.meta.url)), '-Artifact', artifact, '-CabinetDirectory', cabinets], options);
	const plan = planMsiPayload(JSON.parse(metadata.stdout.replace(/^\uFEFF/u, '').trim()), productId === 'soundscaper' ? 'Soundscaper' : productId === 'framescaper' ? 'Framescaper' : '');
	const entries = new Map();
	for (let index = 0; index < plan.cabinetCount; index++) {
		const cabinet = join(cabinets, `cab-${index}.cab`), output = join(rawRoot, String(index));
		// Listing before extraction rejects directory/traversal names and duplicate cabinet identities.
		const listing = await execute(sevenZip, ['l', '-slt', '-ba', cabinet], options);
		const names = [...listing.stdout.matchAll(/^Path = (.+)\r?$/gmu)].map(match => match[1].trim());
		const inventory = new Set(names);
		if (!names.length || names.some(name => !/^[A-Za-z0-9_.-]+$/u.test(name) || name === '.' || name === '..')
			|| inventory.size !== names.length) throw new Error('Invalid MSI cabinet file inventory.');
		await execute(sevenZip, ['x', '-y', '-bd', `-o${output}`, cabinet], options);
		for (const entry of await readdir(output, { withFileTypes: true })) {
			if (!entry.isFile() || entry.isSymbolicLink() || entries.has(entry.name) || !inventory.has(entry.name)) throw new Error('Unexpected MSI cabinet payload.');
			entries.set(entry.name, join(output, entry.name));
		}
		if (names.some(name => !entries.has(name))) throw new Error('MSI cabinet extraction omitted a file.');
	}
	if (entries.size !== plan.files.length) throw new Error('MSI cabinets do not match their File table.');
	for (const file of plan.files) {
		const source = entries.get(file.id);
		if (!source || (await lstat(source)).size !== file.size) throw new Error('MSI file identity or size mismatch.');
		const destination = resolve(extractedRoot, file.path);
		await mkdir(dirname(destination), { recursive: true });
		await copyFile(source, destination);
	}
	return extractedRoot;
}
