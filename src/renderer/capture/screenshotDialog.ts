// Screenshot preview: capture, edit, then copy to the clipboard or save.

import { api } from '../api';
import { deviceName } from '../devices';
import { toast } from '../ui/toast';
import { fileTimestamp } from '../util/text';
import { button, openDialog, separator } from './dialog';
import { ImageEditor, type Tool } from './imageEditor';

const COLORS = ['#FF3B30', '#FFCC00', '#34C759', '#0A84FF', '#FFFFFF', '#000000'];

const TOOLS: { tool: Tool; icon: string; title: string; key: string }[] = [
  { tool: 'crop', icon: 'i-crop', title: 'Crop (C)', key: 'c' },
  { tool: 'pen', icon: 'i-pen', title: 'Pen (P)', key: 'p' },
  { tool: 'arrow', icon: 'i-arrow', title: 'Arrow (A)', key: 'a' },
  { tool: 'rect', icon: 'i-rect', title: 'Rectangle (R)', key: 'r' },
  { tool: 'text', icon: 'i-text', title: 'Text (T)', key: 't' },
  { tool: 'pixelate', icon: 'i-pixelate', title: 'Pixelate, to hide sensitive data (X)', key: 'x' },
];

async function capture(serial: string): Promise<ImageBitmap> {
  const png = await api.captureScreenshot(serial);
  return createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }));
}

export function openScreenshotDialog(serial: string): void {
  const name = deviceName(serial);
  const dialog = openDialog({
    title: `Screenshot · ${name}`,
    className: 'capture-dialog',
    onKey: ev => onKey(ev),
  });

  const stage = document.createElement('div');
  stage.className = 'capture-stage';
  const canvas = document.createElement('canvas');
  canvas.hidden = true;
  const status = document.createElement('div');
  status.className = 'capture-status';
  stage.append(canvas, status);
  dialog.body.appendChild(stage);
  const editor = new ImageEditor(canvas, stage);

  // ----- toolbar -----
  const toolButtons = new Map<Tool, HTMLButtonElement>();
  const selectTool = (tool: Tool) => {
    editor.setTool(tool);
    for (const [t, b] of toolButtons) b.classList.toggle('on', t === tool);
  };
  const recapture = button('i-camera', '', 'Recapture', () => void load());
  const undo = button('i-undo', '', 'Undo (Ctrl+Z)', () => editor.undo());
  const redo = button('i-redo', '', 'Redo (Ctrl+Y)', () => editor.redo());
  const size = document.createElement('span');
  size.className = 'capture-size';
  dialog.toolbar.append(
    recapture, separator(),
    button('i-rotate-left', '', 'Rotate left', () => editor.rotate(-1)),
    button('i-rotate-right', '', 'Rotate right', () => editor.rotate(1)),
    separator(),
  );
  for (const t of TOOLS) {
    const b = button(t.icon, '', t.title, () => selectTool(t.tool));
    toolButtons.set(t.tool, b);
    dialog.toolbar.append(b);
  }
  dialog.toolbar.append(separator());
  const swatches = COLORS.map(color => {
    const s = document.createElement('button');
    s.className = 'swatch';
    s.style.background = color;
    s.title = color;
    s.addEventListener('click', () => {
      editor.color = color;
      swatches.forEach(x => x.classList.toggle('on', x === s));
    });
    return s;
  });
  swatches[0].classList.add('on');
  dialog.toolbar.append(...swatches, separator(), undo, redo, Object.assign(document.createElement('span'), { className: 'spacer' }), size);

  // ----- footer -----
  const copy = button('i-copy', 'Copy to Clipboard', 'Copy the image (Ctrl+C)', () => void copyImage());
  const save = button('i-save', 'Save…', 'Save as PNG (Ctrl+S)', () => void saveImage(), 'primary');
  dialog.footer.append(Object.assign(document.createElement('span'), { className: 'spacer' }), copy, save);

  editor.onChange = () => {
    undo.disabled = !editor.canUndo;
    redo.disabled = !editor.canRedo;
    size.textContent = `${editor.width} × ${editor.height}`;
  };
  selectTool('arrow');

  const setBusy = (busy: boolean, text = '') => {
    status.textContent = text;
    status.hidden = !text;
    for (const b of [recapture, copy, save]) b.disabled = busy;
  };

  async function load(): Promise<void> {
    setBusy(true, 'Capturing…');
    try {
      const image = await capture(serial);
      editor.load(image);
      image.close();
      canvas.hidden = false;
      setBusy(false);
    } catch (e) {
      setBusy(false, 'Screenshot failed: ' + (e as Error).message);
      copy.disabled = save.disabled = true;
    }
  }

  async function copyImage(): Promise<void> {
    try {
      await api.copyImage(await editor.toPng());
      toast('Screenshot copied to the clipboard');
    } catch (e) {
      toast('Copy failed: ' + (e as Error).message);
    }
  }

  async function saveImage(): Promise<void> {
    try {
      const file = `screenshot-${name.replace(/[^\w.-]+/g, '_')}-${fileTimestamp()}.png`;
      const saved = await api.saveImage(await editor.toPng(), file);
      if (saved) toast('Screenshot saved to ' + saved);
    } catch (e) {
      toast('Save failed: ' + (e as Error).message);
    }
  }

  function onKey(ev: KeyboardEvent): boolean {
    if ((ev.target as HTMLElement).matches('input, textarea')) return false; // text tool typing
    const mod = ev.ctrlKey || ev.metaKey;
    const k = ev.key.toLowerCase();
    if (mod && k === 'z') { if (ev.shiftKey) editor.redo(); else editor.undo(); return true; }
    if (mod && k === 'y') { editor.redo(); return true; }
    if (mod && k === 'c') { void copyImage(); return true; }
    if (mod && k === 's') { void saveImage(); return true; }
    const tool = !mod && TOOLS.find(t => t.key === k);
    if (tool) { selectTool(tool.tool); return true; }
    return false;
  }

  void load();
}
