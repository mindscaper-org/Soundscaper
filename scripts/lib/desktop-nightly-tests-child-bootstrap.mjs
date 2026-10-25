/* SPDX-License-Identifier: AGPL-3.0-only */

import { pathToFileURL } from 'node:url';

// Emitting SIGINT inside Node also works on Windows, where child.kill('SIGINT')
// terminates immediately instead of giving Playwright time to close workers.
process.on('message', (message) => {
	if (message?.type !== 'soundscaper-nightly-pause') return;
	const interrupt = () => {
		if (process.listenerCount('SIGINT') > 0) process.emit('SIGINT');
		else setTimeout(interrupt, 20).unref();
	};
	interrupt();
});
process.argv.splice(1, 1);
await import(pathToFileURL(process.argv[1]).href);
