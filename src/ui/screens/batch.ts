import { download, removePage } from '../../app/process';
import { store } from '../../app/store';
import { heavyWorker } from '../../app/workers';
import { h, icons, svg, toast } from '../dom';

export function batchScreen(root: HTMLElement) {
  const list = h('ul', { class: 'pages' });
  const empty = h('div', { class: 'empty' }, 'No pages yet. ', h('a', { href: '#/capture' }, 'Scan one'), '.');
  const pdfTile = h('button', { class: 'tile', type: 'button', 'aria-pressed': String(store.settings.exportPdf) }, h('b', null, 'PDF'), h('span', null, 'one file, pages at true size'));
  const pngTile = h('button', { class: 'tile', type: 'button', 'aria-pressed': String(store.settings.exportPng) }, h('b', null, 'PNG'), h('span', null, 'lossless, one per page'));
  pdfTile.addEventListener('click', () => { const v = !store.settings.exportPdf; pdfTile.setAttribute('aria-pressed', String(v)); store.saveSettings({ exportPdf: v }); });
  pngTile.addEventListener('click', () => { const v = !store.settings.exportPng; pngTile.setAttribute('aria-pressed', String(v)); store.saveSettings({ exportPng: v }); });
  const fill = h('span', { class: 'fill', style: 'width:100%' });
  const label = h('span');
  const exportBtn = h('button', { class: 'btn primary block progress-btn', style: 'background:#6F7797' }, fill, label) as HTMLButtonElement;
  let exporting = false;

  root.append(h('main', { class: 'screen' },
    h('div', { class: 'topbar' }, h('a', { class: 'back', href: '#/capture' }, svg(icons.back), 'Scan more'), h('h1', { style: 'text-align:right' }, 'Batch')),
    list, empty,
    h('section', { style: 'margin-top:24px;display:flex;flex-direction:column;gap:10px' }, h('div', { class: 'toggle-tiles' }, pdfTile, pngTile)),
    h('div', { class: 'spacer' }),
    h('p', { class: 'muted', style: 'text-align:center;font-size:13px;margin:20px 0 12px' }, 'Processed on this device. Nothing is uploaded.'),
    exportBtn));

  const rows = new Map<string, HTMLLIElement>();
  const render = () => {
    const pages = store.pages;
    empty.style.display = pages.length ? 'none' : '';
    const seen = new Set<string>();
    pages.forEach((p, i) => {
      seen.add(p.id);
      let li = rows.get(p.id);
      if (!li) {
        li = h('li', { style: `animation-delay:${Math.min(i, 8) * 0.05}s` });
        rows.set(p.id, li);
        list.append(li);
      }
      const g = p.geometry;
      const meta = p.status === 'processing' ? `${p.note ?? 'processing'}… ${Math.round(p.progress * 100)}%`
        : p.status === 'error' ? p.error ?? 'failed'
        : g ? `${(g.rotate % 2 ? g.heightMm : g.widthMm).toFixed(1)} × ${(g.rotate % 2 ? g.widthMm : g.heightMm).toFixed(1)} mm · ${p.clean.mode === 'bw' ? 'B&W' : p.clean.mode === 'gray' ? 'grey' : 'colour'}${g.warnings.length ? ' · check' : ''}` : '';
      const del = h('button', { class: 'roundbtn', type: 'button', 'aria-label': `Remove page ${i + 1}`, style: 'background:transparent' }, svg(icons.close));
      del.addEventListener('click', () => {
        li!.classList.add('leaving');
        setTimeout(() => removePage(p.id), 300);
      });
      li.replaceChildren(
        h('button', { class: 'thumb', type: 'button', 'aria-label': `Open page ${i + 1}`, style: p.thumb ? `background-image:url(${p.thumb})` : '', onclick: () => (location.hash = `#/review/${p.id}`) }),
        h('div', { class: 'meta' }, h('b', null, `Page ${i + 1}`), h('span', null, meta), h('div', { class: 'bar' }, h('i', { style: `width:${Math.round((p.status === 'ready' ? 1 : p.progress) * 100)}%` }))),
        del);
    });
    for (const [id, li] of rows) if (!seen.has(id)) { li.remove(); rows.delete(id); }
    if (!exporting) {
      const ready = pages.filter((p) => p.status === 'ready').length;
      label.textContent = ready ? `Export ${ready} page${ready > 1 ? 's' : ''}` : 'Export';
      exportBtn.disabled = ready === 0;
    }
  };
  render();
  const unsub = store.subscribe(render);

  exportBtn.addEventListener('click', async () => {
    if (exporting) return;
    const pages = store.pages.filter((p) => p.status === 'ready' && p.geometry);
    const pdf = store.settings.exportPdf, png = store.settings.exportPng;
    if (!pdf && !png) return toast('Choose PDF, PNG or both');
    exporting = true;
    exportBtn.disabled = true;
    fill.style.width = '0%';
    try {
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/(\d{8})(\d{4})/, '$1-$2');
      const res = await heavyWorker().call(
        { op: 'exportPages', pages: pages.map((p) => ({ pageId: p.id, photo: p.photo, geometry: p.geometry!, clean: { ...p.clean, ppm: 0 } })), pdf, png, title: `Pagelight scan ${stamp}` },
        [],
        (f, note) => { fill.style.width = `${Math.round(f * 100)}%`; label.textContent = `${note ?? 'Exporting'}… ${Math.round(f * 100)}%`; });
      if (res.pdf) download(res.pdf, `pagelight-${stamp}.pdf`);
      res.pngs?.forEach((b, i) => setTimeout(() => download(b, `pagelight-${stamp}-p${i + 1}.png`, 'image/png'), 300 * (i + 1)));
      fill.style.width = '100%';
      label.textContent = 'Done — export again';
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Export failed');
      label.textContent = 'Export';
    } finally {
      exporting = false;
      exportBtn.disabled = false;
    }
  });

  return unsub;
}
