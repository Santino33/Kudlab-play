import { MOON_PATH, STAR_PATH } from '../games/tg01/canvas';
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className; if (text) node.textContent = text; return node;
}
export function button(text: string, action: () => void, className = 'button secondary'): HTMLButtonElement {
  const node = el('button', className, text); node.type = 'button'; node.addEventListener('click', action); return node;
}
export function shape(kind: 'star' | 'moon'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('aria-hidden', 'true'); svg.classList.add('shape', kind);
  const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', kind === 'star' ? STAR_PATH : MOON_PATH); svg.append(path); return svg;
}
