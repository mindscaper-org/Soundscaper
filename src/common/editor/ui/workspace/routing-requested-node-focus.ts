/* SPDX-License-Identifier: AGPL-3.0-only */

const requests = new WeakMap<Element, symbol>();

/** Preserve a source port or inspector control focused after node creation. */
export function scheduleRequestedRoutingNodeFocus(node: HTMLElement | undefined): void {
	if (!node) return;
	const graph = node.closest('[data-soundscaper-routing-graph]');
	if (!graph) return;
	const request = Symbol('routing-node-focus');
	requests.set(graph, request);
	const document = node.ownerDocument, openingFocus = document.activeElement;
	requestAnimationFrame(() => {
		if (requests.get(graph) !== request) return;
		requests.delete(graph);
		const active = document.activeElement;
		if (!node.isConnected || active !== openingFocus && active !== document.body) return;
		node.focus();
	});
}
