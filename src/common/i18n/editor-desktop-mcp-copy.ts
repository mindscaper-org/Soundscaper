/* SPDX-License-Identifier: AGPL-3.0-only */

export const DESKTOP_MCP_COPY_BY_LOCALE = (typeof __SCAPE_DESKTOP_RENDERER__ === 'undefined'
	|| __SCAPE_DESKTOP_RENDERER__) ? Object.freeze({
	en: Object.freeze({
		connection: 'MCP connection',
		disclosure: 'Connected local clients can read project metadata and edit the open project without confirmation for each edit. Share this token only with a client you trust.',
		authorization: 'Connect to the endpoint with an Authorization: Bearer <token> header.',
		closeKeepsRunning: 'Closing this dialog keeps MCP running until you stop it or quit Soundscaper.',
		disabled: 'MCP is off for this session.',
		enabled: 'MCP is running for this session.',
		loading: 'Reading MCP connection status',
		start: 'Start MCP',
		stop: 'Stop MCP',
		endpoint: 'Endpoint',
		token: 'Session token',
		copyEndpoint: 'Copy endpoint',
		copyToken: 'Copy token',
		copied: 'Copied to clipboard.',
		copyFailed: 'Could not copy to clipboard.',
	}),
}) : null;
