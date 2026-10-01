import { calibrationGrade } from '../../core/calibrate';
import { REPO_URL, store } from '../../app/store';
import { h, icons, svg, toast } from '../dom';
import { eye } from '../eye';
import { download } from '../../app/process';

export function setupScreen(root: HTMLElement) {
  const screen = h('main', { class: 'screen' });
  root.append(screen);

  const render = () => {
    const s = store.settings.sheet;
    const profiles = Object.values(store.profiles);
    const latest = profiles.sort((a, b) => b.calibration.date.localeCompare(a.calibration.date))[0];
    const fileInput = h('input', { type: 'file', accept: 'application/json,.json', style: 'display:none' }) as HTMLInputElement;
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      try {
        const n = store.importProfiles(await f.text());
        toast(`Imported ${n} camera profile${n === 1 ? '' : 's'}`);
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Import failed');
      }
    });

    const step = (done: boolean | 'warn', title: string, detail: string, action: HTMLElement) =>
      h('li', null, svg(done === 'warn' ? icons.warn : done ? icons.check : icons.todo), h('div', { class: 'txt' }, h('b', null, title), h('span', null, detail)), action);

    const scaleText = s.scaleChecked ? `print scale ${(s.printScale * 100).toFixed(1)} %` : 'print scale not checked';
    const lensDetail = latest
      ? `${latest.calibration.rmsPx.toFixed(2)} px · ${new Date(latest.calibration.date).toLocaleDateString()}${profiles.length > 1 ? ` · ${profiles.length} cameras` : ''}`
      : 'Not calibrated — optional but more accurate';
    const grade = latest ? calibrationGrade(latest.calibration.rmsPx) : null;

    screen.replaceChildren(
      h('header', { class: 'hero' },
        eye(200, 'idle', 'Pagelight'),
        h('div', { class: 'name' }, 'Pagelight'),
        h('div', { class: 'muted' }, 'Photos of pages to flat, true-size PDFs. Runs entirely on this device.')),
      h('ol', { class: 'steps' },
        step(s.scaleChecked ? true : 'warn', 'Calibration sheet', `${s.preset} ${s.landscape ? 'landscape' : 'portrait'} · ${scaleText}`,
          h('a', { href: '#/sheet', class: 'linkbtn', style: 'display:flex;align-items:center' }, 'Sizes')),
        step(grade === 'redo' ? 'warn' : !!latest, latest ? `Lens, ${shortLabel(latest.label)}` : 'Lens calibration', lensDetail,
          h('a', { href: '#/calibrate', class: 'linkbtn', style: 'display:flex;align-items:center' }, latest ? 'Redo' : 'Start'))),
      h('div', { class: 'footer-links' },
        h('button', { class: 'linkbtn', onclick: () => download(new Blob([store.exportProfiles()], { type: 'application/json' }), 'pagelight-profiles.json') }, 'Export profiles'),
        h('button', { class: 'linkbtn', onclick: () => fileInput.click() }, 'Import'),
        store.pages.length ? h('a', { class: 'linkbtn', href: '#/batch', style: 'display:flex;align-items:center' }, `Batch (${store.pages.length})`) : null,
        fileInput),
      h('a', { class: 'repo', href: REPO_URL, target: '_blank', rel: 'noopener' }, svg(icons.code), 'Source code on GitHub · GPL-3.0'),
      h('div', { class: 'spacer' }),
      h('a', { class: 'btn primary block', href: '#/capture', style: 'margin-top:20px' }, 'Start scanning'),
    );
  };
  render();
  return store.subscribe(render);
}

function shortLabel(l: string) {
  return l.replace(/@.*$/, '').replace(/\s*\(.*\)$/, '').slice(0, 28) || 'camera';
}
