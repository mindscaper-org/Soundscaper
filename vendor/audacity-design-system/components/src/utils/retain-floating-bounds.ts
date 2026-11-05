/** Keep a fixed popup within the viewport while retaining its authored anchor. */
export function retainFloatingBounds(popup: HTMLElement, x: number, y: number): () => void {
	const position = () => {
		const rect = popup.getBoundingClientRect();
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;
		let adjustedX = x;
		let adjustedY = y;
		if (x + rect.width > viewportWidth) adjustedX = viewportWidth - rect.width - 10;
		if (y + rect.height > viewportHeight) adjustedY = viewportHeight - rect.height - 10;
		if (adjustedX < 0) adjustedX = 10;
		if (adjustedY < 0) adjustedY = 10;
		popup.style.left = `${adjustedX}px`;
		popup.style.top = `${adjustedY}px`;
	};
	position();
	const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(position);
	observer?.observe(popup);
	window.addEventListener('resize', position);
	return () => {
		observer?.disconnect();
		window.removeEventListener('resize', position);
	};
}
