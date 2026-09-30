/** Looks up an element that index.html is known to contain. */
export function el<T extends Element = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing element #${id}`);
  return e as unknown as T;
}

/** Elements of the main window (the mirror panel looks up its own). */
export const els = {
  tabs: el('tabs'),
  addTab: el<HTMLButtonElement>('addTab'),

  deviceBtn: el<HTMLButtonElement>('deviceBtn'),
  deviceIcon: el<SVGUseElement>('deviceIcon'),
  deviceLabel: el('deviceLabel'),
  deviceSub: el('deviceSub'),

  procBtn: el<HTMLButtonElement>('procBtn'),
  procLabel: el('procLabel'),
  procSub: el('procSub'),
  procClear: el('procClear'),

  queryBox: el('queryBox'),
  query: el<HTMLInputElement>('query'),
  filterMenu: el<HTMLButtonElement>('filterMenu'),
  queryClear: el<HTMLButtonElement>('queryClear'),
  caseBtn: el<HTMLButtonElement>('caseBtn'),
  favBtn: el<HTMLButtonElement>('favBtn'),
  helpBtn: el<HTMLButtonElement>('helpBtn'),
  helpTpl: el<HTMLTemplateElement>('helpTpl'),
  suggest: el('suggest'),

  clear: el<HTMLButtonElement>('btnClear'),
  pause: el<HTMLButtonElement>('btnPause'),
  pauseIcon: el<SVGUseElement>('pauseIcon'),
  restart: el<HTMLButtonElement>('btnRestart'),
  end: el<HTMLButtonElement>('btnEnd'),
  prev: el<HTMLButtonElement>('btnPrev'),
  next: el<HTMLButtonElement>('btnNext'),
  wrap: el<HTMLButtonElement>('btnWrap'),
  importBtn: el<HTMLButtonElement>('btnImport'),
  exportBtn: el<HTMLButtonElement>('btnExport'),
  format: el<HTMLButtonElement>('btnFormat'),
  shot: el<HTMLButtonElement>('btnShot'),
  record: el<HTMLButtonElement>('btnRecord'),
  recordIcon: el<SVGUseElement>('recordIcon'),
  recBadge: el('recBadge'),
  recText: el('recText'),
  recStop: el<HTMLButtonElement>('recStop'),
  mirror: el<HTMLButtonElement>('btnMirror'),

  log: el('log'),
  probe: el('probe'),
  spacer: el('spacer'),
  rows: el('rows'),
  notice: el('notice'),
  empty: el('empty'),
  follow: el<HTMLButtonElement>('follow'),
  toast: el('toast'),
};
