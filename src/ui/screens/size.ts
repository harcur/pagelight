import { store } from '../../app/store';
import { h, icons, svg } from '../dom';
import { manualMode } from './capture';

const PRESETS: [string, number, number][] = [
  ['A4', 210, 297], ['A3', 297, 420], ['A2', 420, 594], ['A1', 594, 841], ['Letter', 216, 279], ['Tabloid', 279, 432],
];

export function sizeScreen(root: HTMLElement) {
  let [w, hh] = manualMode.size ?? store.settings.lastManualSize;
  const wIn = h('input', { type: 'number', inputmode: 'decimal', value: String(w) }) as HTMLInputElement;
  const hIn = h('input', { type: 'number', inputmode: 'decimal', value: String(hh) }) as HTMLInputElement;
  const go = h('button', { class: 'btn primary', style: 'flex:2' }) as HTMLButtonElement;
  const k = 46 / 841;
  const shapes: HTMLElement[] = [];
  const buttons = PRESETS.map(([name, pw, ph]) => {
    const shape = h('span', { style: `display:block;border-radius:4px;width:${Math.round(pw * k + 6)}px;height:${Math.round(ph * k)}px;transition:background .25s, transform .35s cubic-bezier(.2,.8,.2,1.4)` });
    shapes.push(shape);
    return h('button', { type: 'button', role: 'radio', 'data-w': pw, 'data-h': ph, style: 'border:0;background:none;padding:0;min-height:76px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:6px;cursor:pointer;font-size:12px', onclick: () => { wIn.value = String(pw); hIn.value = String(ph); sync(); } }, shape, name);
  });
  const sync = () => {
    w = parseFloat(wIn.value) || 0;
    hh = parseFloat(hIn.value) || 0;
    buttons.forEach((b, i) => {
      const on = Number(b.dataset.w) === w && Number(b.dataset.h) === hh;
      b.setAttribute('aria-checked', String(on));
      shapes[i].style.background = on ? 'var(--indigo)' : 'var(--line)';
      shapes[i].style.transform = on ? 'translateY(-5px) rotate(-4deg)' : 'none';
      b.style.color = on ? 'var(--indigo)' : 'var(--muted)';
    });
    const p = PRESETS.find(([, pw, ph]) => pw === w && ph === hh);
    go.textContent = `Capture at ${p ? p[0] : `${w} × ${hh}`}`;
    go.disabled = !(w >= 50 && hh >= 50 && w <= 2000 && hh <= 2000);
  };
  wIn.addEventListener('input', sync);
  hIn.addEventListener('input', sync);
  go.addEventListener('click', () => {
    manualMode.size = [w, hh];
    store.saveSettings({ lastManualSize: [w, hh] });
    location.hash = '#/capture';
  });

  root.append(h('main', { class: 'screen' },
    h('div', { class: 'topbar' }, h('a', { class: 'back', href: '#/capture', 'aria-label': 'Back to camera' }, svg(icons.back)), h('h1', null, 'Page size')),
    h('p', { class: 'muted', style: 'margin:0 6px 16px;font-size:14px;line-height:1.45' },
      'For pages larger than your calibration sheet. Place the page on a darker surface; its outline is found in the photo and flattened to the size you enter. Curl near a spine is not corrected in this mode.'),
    h('div', { role: 'radiogroup', 'aria-label': 'Preset', style: 'display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px;align-items:end' }, ...buttons),
    h('div', { style: 'display:flex;gap:12px;align-items:flex-end;margin-top:18px' },
      h('label', { class: 'field' }, 'Width, mm', wIn),
      h('span', { class: 'muted', style: 'padding-bottom:14px' }, '×'),
      h('label', { class: 'field' }, 'Height, mm', hIn)),
    h('div', { class: 'spacer' }),
    h('div', { style: 'display:flex;gap:10px;margin-top:24px' },
      manualMode.size ? h('button', { class: 'btn outline', style: 'flex:1', onclick: () => { manualMode.size = null; location.hash = '#/capture'; } }, 'Use sheet') : h('a', { class: 'btn outline', style: 'flex:1', href: '#/capture' }, 'Cancel'),
      go),
  ));
  sync();
}
