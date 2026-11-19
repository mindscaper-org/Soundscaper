/* SPDX-License-Identifier: AGPL-3.0-only */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { MotionscaperLocaleSettings } from './motionscaper-locale.ts';

/** English menu fixtures use normal persisted settings in an exclusively owned profile. */
export async function prepareMotionQualificationLocale(directory: string): Promise<string> {
	const profile = join(directory, 'profile');
	await mkdir(profile, { mode: 0o700 });
	await new MotionscaperLocaleSettings(join(profile, 'locale-settings.json')).set('en');
	return profile;
}
