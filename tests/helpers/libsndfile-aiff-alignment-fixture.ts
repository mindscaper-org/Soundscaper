/* SPDX-License-Identifier: AGPL-3.0-only */

import { unzlibSync } from 'fflate';

// Untouched libsndfile 1.2.2 recordings. Each SSND size includes one zero alignment byte.
const RECORDINGS = {
	'plain-s24.aif': 'eNrtyLENglAARdHnAkatLB3BhNJGo/mJBZLImk7gFIzACIzAD2xAfV717indt02a8fEu5dm19eeUXXK85Xzf/1616/r+U1/zXyu5JIdkTKbkusgAIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIdyKmQHR8mrt',
	'c-be24.aifc': 'eNrtyLENAQEARuFfohY6pREEnYYclyjOxV1iB40ZzKI2gSmMYAQxgQsbqL/Xva+smyqZv9e7siiP2yZJ/3o5rIq66jzj9JLRMuPV4Lbpvut0ni2Stt13P7//LJkkw+SZvJLpVx4QQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQwn8xH859byk=',
	'c-le24.aifc': 'eNrtyL0NAQEAhuFPohY6pRH8dRqCSxTn4i4xhhnMojaBKYxgBDGBwwbq5+3ep6jqMpm9VrtiXRy3dZLu5XxYrquy9QzTSQaLDJe966b9tvn0NEmaZt/+7PazT6OknzySZzL+yh1CCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBC+Ce+AbTEbvE=',
};
const PATTERN = [0.25, 0.125, -0.25, -0.125, 0.375, 0, -0.375] as const;

export function libsndfileAiffAlignmentFixture() {
	const files = Object.entries(RECORDINGS).map(([name, compressed]) => (
		new File([unzlibSync(Uint8Array.from(atob(compressed), character => character.charCodeAt(0)))], name, { type: 'audio/x-aiff' })
	));
	const frameCount = 4_411;
	const samples = Float32Array.from({ length: frameCount }, (_, frame) => PATTERN[frame % PATTERN.length]!);
	return { files, frameCount, samples, sampleRate: 44_100 };
}
