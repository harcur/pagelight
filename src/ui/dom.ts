// Tiny DOM helpers. No framework: screens build elements and update them directly.

type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown> & { style?: Partial<CSSStyleDeclaration> | string; class?: string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) applyProps(el, props);
  append(el, children);
  return el;
}

export function append(el: Node, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

function applyProps(el: HTMLElement, props: Props) {
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'style') {
      if (typeof v === 'string') el.setAttribute('style', v);
      else Object.assign(el.style, v);
    } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'html') el.innerHTML = String(v);
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

/** Parse a trusted, app-authored SVG string (icons, the eye) into an element. */
export function svg(markup: string): SVGSVGElement {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild as SVGSVGElement;
}

export const icons = {
  back: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 3 L5 9 L11 15"/></svg>',
  settings: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><polygon points="3,7 9,2 17,5 18,13 11,18 3,14"/><circle cx="10" cy="10" r="2.6"/></svg>',
  size: '<svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M5 3 H18 L22 7 V23 H5 Z"/><path d="M9 23 V20 M13 23 V19 M17 23 V20"/></svg>',
  photo: '<svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="20" height="16" rx="3"/><path d="M3 17 l6-6 5 5 3-3 6 6"/><circle cx="17.5" cy="10" r="1.8"/></svg>',
  close: '<svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12"/></svg>',
  rotate: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15.5 8A6 6 0 1 0 16 12"/><path d="M16 3v5h-5"/></svg>',
  code: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4 L1.5 8 L5 12 M11 4 L14.5 8 L11 12"/></svg>',
  check: '<svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><polygon points="4,10 13,2 26,6 28,19 17,28 5,23" fill="#2F3A64"/><path d="M9 15l4 4 8-9" fill="none" stroke="#FBF8F2" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  todo: '<svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><polygon points="5,8 16,3 27,10 25,23 12,28 3,19" fill="none" stroke="#8E857A" stroke-width="1.4" stroke-dasharray="3 3"/></svg>',
  warn: '<svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><polygon points="3,14 9,3 22,4 28,14 21,27 8,25" fill="#D9A441"/><path d="M15 9v8M15 21v.5" stroke="#1F1D1A" stroke-width="2.4" stroke-linecap="round"/></svg>',
  poly: '<svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true"><polygon class="spinpoly" points="2,7 7,2 14,3 17,9 12,16 4,14" fill="#2F3A64"/></svg>',
};

/** Segmented control with a sliding indicator. */
export function segmented<T extends string>(options: { id: T; label: string }[], value: T, onChange: (v: T) => void, cls = ''): HTMLElement & { set(v: T): void } {
  const ind = h('span', { class: 'ind' });
  const root = h('div', { class: `seg ${cls}`, role: 'radiogroup' }, ind) as unknown as HTMLElement & { set(v: T): void };
  const buttons = options.map((o) => {
    const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(o.id === value), onclick: () => { root.set(o.id); onChange(o.id); } }, o.label);
    root.append(b);
    return b;
  });
  root.set = (v: T) => {
    const i = options.findIndex((o) => o.id === v);
    buttons.forEach((b, j) => b.setAttribute('aria-checked', String(j === i)));
    ind.style.width = `calc((100% - 8px) / ${options.length})`;
    ind.style.transform = `translateX(${i * 100}%)`;
  };
  root.set(value);
  return root;
}

export function switchControl(title: string, sub: string, value: boolean, onChange: (v: boolean) => void): HTMLButtonElement {
  const b = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(value) },
    h('span', { class: 'track' }, h('span', { class: 'knob' })),
    h('span', { class: 't' }, h('b', null, title), h('span', null, sub)));
  b.addEventListener('click', () => {
    const v = b.getAttribute('aria-checked') !== 'true';
    b.setAttribute('aria-checked', String(v));
    onChange(v);
  });
  return b;
}

let toastTimer = 0;
export function toast(msg: string) {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.remove(), 3800);
}

export function fmtMm(v: number) {
  return v.toFixed(1);
}
