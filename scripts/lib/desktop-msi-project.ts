/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { link, mkdtemp } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { calendarPackageVersion } from '../../src/common/release/release-packaging.ts';
import { parseReleaseVersion } from '../../src/common/release/release-version.ts';

/** Two base-256 day fields retain the full existing 16-bit per-day revision. */
export function msiPackageVersion(value: string): string {
	const version = parseReleaseVersion(value);
	if (version?.kind !== 'calendar') throw new TypeError('MSI requires a named calendar release.');
	const day = (Date.UTC(version.year, version.month, version.day) - Date.UTC(2000, 0, 1)) / 86_400_000;
	if (!Number.isInteger(day) || day < 0 || day > 65_535) throw new RangeError('The MSI release date is outside the supported range.');
	const revision = calendarPackageVersion(value).split('.')[2]!;
	return `${Math.floor(day / 256)}.${day % 256}.${revision}`;
}

export function prepareMsiProject(source: string, productId: string, version: string): string {
	const product = productId === 'soundscaper' ? 'Soundscaper' : productId === 'framescaper' ? 'Framescaper' : null;
	if (!product || parseReleaseVersion(version)?.kind !== 'calendar' || !version.startsWith(product)) throw new TypeError('MSI product identity is invalid.');
	if (!source.includes(`Name="${product}"`)) throw new Error('The MSI project belongs to another product.');
	if (!/<Product\b[^>]*\bVersion="[^"]+"/u.test(source)
		|| !source.includes('<ComponentGroup Id="ProductComponents" Directory="APPLICATIONFOLDER">')
		|| source.includes('ManagedInstallerRegistration')) throw new Error('Unexpected MSI project structure.');
	const uninstallKey = nsisUninstallKey(`org.${productId}.desktop`);
	const detection = `<Property Id="EXISTING_NSIS_INSTALLATION"><RegistrySearch Id="ExistingNsisInstallation" Root="HKLM" Key="Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${uninstallKey}" Name="UninstallString" Type="raw" Win64="yes"/></Property>
    <Condition Message="Uninstall the existing ${product} EXE installation before installing the managed MSI. Your projects and preferences will be preserved.">NOT EXISTING_NSIS_INSTALLATION</Condition>`;
	return source.replace(/(<Product\b[^>]*\bVersion=")[^"]+("[^>]*>)/u, `$1${msiPackageVersion(version)}$2\n    ${detection}`)
		.replace('<ComponentGroup Id="ProductComponents" Directory="APPLICATIONFOLDER">', `<ComponentGroup Id="ProductComponents" Directory="APPLICATIONFOLDER">
      <Component Id="ManagedInstallerRegistration" Guid="*" Win64="yes">
        <RegistryValue Root="HKLM" Key="Software\\Mindscaper\\${product}\\Installation" Name="ManagedByWindowsInstaller" Type="integer" Value="1" KeyPath="yes"/>
      </Component>`);
}

/** Keep WiX's legacy binder paths short without changing the files in the installed tree. */
export async function stageLongMsiSources(source: string, projectPath: string, applicationRoot: string): Promise<string> {
	const declaration = /(<File\b[^>]*?\sSource=")\$\(var\.appDir\)[\\/]([^"]+)"/gu;
	const aliases = new Map<string, string>();
	let directory: string | undefined;
	for (const match of source.matchAll(declaration)) {
		const relative = match[2]!;
		if (aliases.has(relative)) continue;
		const parts = unescapeXml(relative).split(/[\\/]/u);
		if (parts.some(part => part === '' || part === '.' || part === '..' || part.includes(':'))) {
			throw new Error('WiX source must stay inside the unpacked application.');
		}
		const path = join(applicationRoot, ...parts);
		if (path.length < 260) continue;
		directory ??= await mkdtemp(join(dirname(projectPath), 'files-'));
		const alias = join(directory, `${aliases.size}${extname(path)}`);
		if (alias.length >= 260) throw new Error('The WiX build directory is too deep for a short source path.');
		await link(path, alias);
		aliases.set(relative, alias.replace(/[&<>"']/gu, character => `&${XML_ENTITIES[character]};`));
	}
	return source.replaceAll(declaration, (whole: string, prefix: string, relative: string) => {
		const alias = aliases.get(relative);
		return alias === undefined ? whole : `${prefix}${alias}"`;
	});
}

const XML_ENTITIES: Readonly<Record<string, string>> = {
	'&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot', "'": 'apos',
};
const XML_CHARACTERS = Object.fromEntries(Object.entries(XML_ENTITIES).map(([character, name]) => [name, character]));
function unescapeXml(value: string): string {
	return value.replace(/&(amp|lt|gt|quot|apos);/gu, (_entity: string, name: string) => XML_CHARACTERS[name]!);
}

// Match electron-builder's existing NSIS product identity, without changing its namespace.
function nsisUninstallKey(appId: string): string {
	const namespace = Buffer.from('50e065bc313411e69bab38c9862bdaf3', 'hex');
	const bytes = createHash('sha1').update(namespace).update(appId).digest().subarray(0, 16);
	bytes[6] = (bytes[6]! & 0x0f) | 0x50;
	bytes[8] = (bytes[8]! & 0x3f) | 0x80;
	const hex = bytes.toString('hex');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
