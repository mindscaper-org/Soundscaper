/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { displayText, publicStablePluginId } from '../desktop/plugin-registry-display.ts';

test('registry labels remove path separators and empty names remain visible', () => {
	assert.equal(displayText('/etc/passwd'), 'etc passwd');
	assert.equal(displayText('C:\\Windows\\System32'), 'C: Windows System32');
	assert.equal(displayText(' / \\ '), '(unnamed)');
});

test('only bounded pathless plug-in IDs appear in the public registry', () => {
	assert.deepEqual(publicStablePluginId('org.soundscaper.juce.chorus'), { stablePluginId: 'org.soundscaper.juce.chorus' });
	for (const value of ['', '/etc/passwd', 'C:\\Windows\\plugin', 'file:///tmp/plugin', 'x'.repeat(257), 'hello\u0000world']) {
		assert.deepEqual(publicStablePluginId(value), {});
	}
});
