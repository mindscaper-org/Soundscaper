/* SPDX-License-Identifier: AGPL-3.0-only */
export function edlSourceComments(fileFirst: boolean, sourceKeyword: 'SOURCE FILE' | 'FROM FILE'): string {
	const comments = [`* ${sourceKeyword}: media/Actual.wav`, '* FROM CLIP NAME: Dialogue edit.NEW.01'];
	return `TITLE: Source comment order\nFCM: NON-DROP FRAME\n* FPS: 25\n001 AX A C 00:00:00:00 00:00:01:00 01:00:00:00 01:00:01:00\n${(fileFirst ? comments : comments.toReversed()).join('\n')}\n`;
}
