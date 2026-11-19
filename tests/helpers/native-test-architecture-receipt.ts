/* SPDX-License-Identifier: AGPL-3.0-only */

export function architectureReceipt(target: string): Readonly<{
	schemaVersion: 1; target: string; architecture: string | undefined; format: string; machine: string;
}> {
	const [platform, architecture] = target.split('-');
	return {
		schemaVersion: 1, target, architecture,
		format: platform === 'linux' ? 'elf64-le'
			: platform === 'win' ? 'pe32-plus' : 'mach-o-64-le',
		machine: platform === 'linux'
			? architecture === 'x64' ? 'EM_X86_64' : 'EM_AARCH64'
			: platform === 'win'
				? architecture === 'x64' ? 'IMAGE_FILE_MACHINE_AMD64' : 'IMAGE_FILE_MACHINE_ARM64'
				: 'CPU_TYPE_ARM64',
	};
}
