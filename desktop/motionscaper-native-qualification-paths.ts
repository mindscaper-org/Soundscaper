/* SPDX-License-Identifier: AGPL-3.0-only */
import { posix, win32 } from 'node:path';
import { motionQualificationTarget } from './motionscaper-qualification-platform.ts';

/** Test harness paths only. Every package input is the target unpacked container. */
export function resolveMotionQualificationPaths(root: string, product: 'motionscaper' | 'framescaper-successor', arch: string,
	env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform) {
	motionQualificationTarget(platform, arch);
	const paths = platform === 'win32' ? win32 : posix, prefix = product === 'motionscaper' ? 'MOTIONSCAPER' : 'FRAMESCAPER_SUCCESSOR';
	const name = product === 'motionscaper' ? 'Motionscaper' : 'Framescaper Development';
	const directory = platform === 'darwin' ? 'mac-arm64' : `${platform === 'win32' ? 'win' : 'linux'}${arch === 'x64' ? '' : '-arm64'}-unpacked`;
	const path = (value: string) => {
		if (!value || value.length > 8192 || value.includes('\0') || !paths.isAbsolute(value) || paths.normalize(value) !== value) throw new TypeError('Qualification path must be bounded, absolute and normalized.');
		return value;
	};
	const stage = path(env[`${prefix}_QUALIFICATION_STAGE`] ?? paths.join(root, '.desktop-build', ...(product === 'motionscaper' ? [] : ['framescaper-successor'])));
	const packaged = path(env[`${prefix}_QUALIFICATION_PACKAGE`] ?? paths.join(root, 'release', ...(product === 'motionscaper' ? ['desktop-nightly-products', 'motionscaper'] : ['framescaper-successor']), directory));
	const bundle = platform === 'darwin' ? paths.join(packaged, `${name}.app`) : packaged;
	return Object.freeze({ stage, package: packaged,
		executable: platform === 'darwin' ? paths.join(bundle, 'Contents', 'MacOS', name) : paths.join(packaged, platform === 'win32' ? `${name}.exe` : product),
		resources: paths.join(bundle, ...(platform === 'darwin' ? ['Contents', 'Resources'] : ['resources'])),
	});
}
