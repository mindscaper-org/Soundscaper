// @ts-check
/* SPDX-License-Identifier: AGPL-3.0-only */

if (process.env.SCAPE_WIN_SIGNING && process.env.SCAPE_WIN_SIGNING !== 'none') {
	throw new Error('Use npm run desktop:appx; AppX uses Store package signing, not SCAPE_WIN_SIGNING.');
}
const { createDesktopAppxConfig } = require('./scripts/lib/desktop-appx-config.cjs');
module.exports = createDesktopAppxConfig(require('./electron-builder.config.cjs'));
