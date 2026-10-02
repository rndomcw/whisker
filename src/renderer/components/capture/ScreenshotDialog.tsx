// Screenshot preview: capture, edit, then copy to the clipboard or save.

import { createSignal, For, onMount, Show } from 'solid-js';
import { api } from '../../api';
import { deviceName } from '../../state/devices';
import { openDialog } from '../../state/dialog';
import { toast } from '../../state/toast';
import { fileTimestamp } from '../../util/text';
import { Dialog, DialogButton } from '../Dialog';
import { captureDialog, captureStage, cx, Separator } from '../ui';
import { ImageEditor, type Tool } from './ImageEditor';

const COLORS = ['#FF3B30', '#FFCC00', '#34C759', '#0A84FF', '#FFFFFF', '#000000'];

const TOOLS: { tool: Tool; icon: string; title: string; key: string }[] = [
  { tool: 'crop', icon: 'crop', title: 'Crop (C)', key: 'c' },
  { tool: 'pen', icon: 'pen', title: 'Pen (P)', key: 'p' },
  { tool: 'arrow', icon: 'arrow', title: 'Arrow (A)', key: 'a' },
  { tool: 'rect', icon: 'rect', title: 'Rectangle (R)', key: 'r' },
  { tool: 'text', icon: 'text', title: 'Text (T)', key: 't' },
  { tool: 'pixelate', icon: 'pixelate', title: 'Pixelate, to hide sensitive data (X)', key: 'x' },
];

async function capture(serial: string): Promise<ImageBitmap> {
  const png = await api.captureScreenshot(serial);
  return createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }));
}

export function openScreenshotDialog(serial: string): void {
  openDialog(() => <ScreenshotDialog serial={serial} />);
}

function ScreenshotDialog(props: { serial: string }) {
  const name = deviceName(props.serial);
  let canvas!: HTMLCanvasElement;
  let stage!: HTMLDivElement;
  let editor!: ImageEditor;
  const [tool, setTool] = createSignal<Tool>('arrow');
  const [color, setColor] = createSignal(COLORS[0]);
  const [history, setHistory] = createSignal({ canUndo: false, canRedo: false, size: '' });
  const [busy, setBusy] = createSignal(true);
  const [loaded, setLoaded] = createSignal(false);
  const [status, setStatus] = createSignal('');

  const selectTool = (t: Tool) => { editor.setTool(t); setTool(t); };
  const pickColor = (c: string) => { editor.color = c; setColor(c); };

  async function load(): Promise<void> {
    setBusy(true);
    setStatus('Capturing…');
    try {
      const image = await capture(props.serial);
      editor.load(image);
      image.close();
      setLoaded(true);
      setStatus('');
    } catch (e) {
      setLoaded(false);
      setStatus('Screenshot failed: ' + (e as Error).message);
    }
    setBusy(false);
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
    if (ev.target instanceof Element && ev.target.matches('input, textarea')) return false; // text tool typing
    const mod = ev.ctrlKey || ev.metaKey;
    const k = ev.key.toLowerCase();
    if (mod && k === 'z') { if (ev.shiftKey) editor.redo(); else editor.undo(); return true; }
    if (mod && k === 'y') { editor.redo(); return true; }
    if (mod && k === 'c') { void copyImage(); return true; }
    if (mod && k === 's') { void saveImage(); return true; }
    const t = !mod && TOOLS.find(x => x.key === k);
    if (t) { selectTool(t.tool); return true; }
    return false;
  }

  onMount(() => {
    editor = new ImageEditor(canvas, stage);
    editor.onChange = () => setHistory({ canUndo: editor.canUndo, canRedo: editor.canRedo, size: `${editor.width} × ${editor.height}` });
    selectTool('arrow');
    void load();
  });

  const cannotExport = () => busy() || !loaded();

  return (
    <Dialog
      title={`Screenshot · ${name}`}
      class={captureDialog}
      onKey={onKey}
      toolbar={<>
        <DialogButton icon="camera" title="Recapture" disabled={busy()} onClick={() => void load()} />
        <Separator vertical />
        <DialogButton icon="rotate-left" title="Rotate left" onClick={() => editor.rotate(-1)} />
        <DialogButton icon="rotate-right" title="Rotate right" onClick={() => editor.rotate(1)} />
        <Separator vertical />
        <For each={TOOLS}>{t => <DialogButton icon={t.icon} title={t.title} on={tool() === t.tool} onClick={() => selectTool(t.tool)} />}</For>
        <Separator vertical />
        <For each={COLORS}>
          {c => (
            <button
              class={cx(
                'mx-0.5 size-[18px] rounded-full border-2 border-panel',
                color() === c ? 'shadow-[0_0_0_2px_var(--accent)]' : 'shadow-[0_0_0_1px_var(--input-border)]',
              )}
              style={{ background: c }}
              title={c}
              onClick={() => pickColor(c)}
            />
          )}
        </For>
        <Separator vertical />
        <DialogButton icon="undo" title="Undo (Ctrl+Z)" disabled={!history().canUndo} onClick={() => editor.undo()} />
        <DialogButton icon="redo" title="Redo (Ctrl+Y)" disabled={!history().canRedo} onClick={() => editor.redo()} />
        <span class="flex-1" />
        <span class="whitespace-nowrap text-[12px] text-dim">{history().size}</span>
      </>}
      footer={<>
        <span class="flex-1" />
        <DialogButton icon="copy" label="Copy to Clipboard" title="Copy the image (Ctrl+C)" disabled={cannotExport()} onClick={() => void copyImage()} />
        <DialogButton icon="save" label="Save…" title="Save as PNG (Ctrl+S)" primary disabled={cannotExport()} onClick={() => void saveImage()} />
      </>}
    >
      <div class={captureStage} ref={stage}>
        <canvas ref={canvas} hidden={!loaded()} class="block touch-none shadow-[0_2px_16px_rgba(0,0,0,.4)]" />
        <Show when={status()}><div class="text-dim">{status()}</div></Show>
      </div>
    </Dialog>
  );
}
