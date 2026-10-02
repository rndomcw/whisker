// Canvas-based screenshot editor: rotate, crop, pen, arrow, rectangle, text and pixelate, with undo/redo.
// Every edit is drawn straight into the canvas; undo keeps snapshots of the canvas before each edit.

export type Tool = 'crop' | 'pen' | 'arrow' | 'rect' | 'text' | 'pixelate';

type Point = [number, number];

const MAX_UNDO = 30;

function copyCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d')!.drawImage(src, 0, 0);
  return c;
}

/** Normalized rectangle from two corners. */
function rectOf([x0, y0]: Point, [x1, y1]: Point) {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

export class ImageEditor {
  tool: Tool = 'arrow';
  color = '#FF3B30';
  /** Called after any change, e.g. to refresh undo buttons and the size label. */
  onChange: () => void = () => {};

  private readonly ctx: CanvasRenderingContext2D;
  private undoStack: HTMLCanvasElement[] = [];
  private redoStack: HTMLCanvasElement[] = [];
  private drag: { start: Point; points: Point[]; base: HTMLCanvasElement } | null = null;
  private textInput: HTMLInputElement | null = null;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly stage: HTMLElement) {
    this.ctx = canvas.getContext('2d')!;
    canvas.addEventListener('pointerdown', ev => this.onDown(ev));
    canvas.addEventListener('pointermove', ev => this.onMove(ev));
    canvas.addEventListener('pointerup', ev => this.onUp(ev));
    new ResizeObserver(() => this.fit()).observe(stage);
  }

  get width(): number { return this.canvas.width; }
  get height(): number { return this.canvas.height; }
  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  /** Starts editing a new image (clears history). */
  load(image: CanvasImageSource & { width: number; height: number }): void {
    this.cancelText();
    this.canvas.width = image.width;
    this.canvas.height = image.height;
    this.ctx.drawImage(image, 0, 0);
    this.undoStack = [];
    this.redoStack = [];
    this.fit();
    this.onChange();
  }

  setTool(tool: Tool): void {
    this.cancelText();
    this.tool = tool;
    this.canvas.style.cursor = tool === 'text' ? 'text' : 'crosshair';
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(copyCanvas(this.canvas));
    this.restore(prev);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(copyCanvas(this.canvas));
    this.restore(next);
  }

  /** Rotates 90° clockwise (1) or counter-clockwise (-1). */
  rotate(dir: 1 | -1): void {
    const before = copyCanvas(this.canvas);
    const w = before.width, h = before.height;
    this.canvas.width = h;
    this.canvas.height = w;
    this.ctx.save();
    this.ctx.translate(dir > 0 ? h : 0, dir > 0 ? 0 : w);
    this.ctx.rotate((dir * Math.PI) / 2);
    this.ctx.drawImage(before, 0, 0);
    this.ctx.restore();
    this.commit(before);
    this.fit();
  }

  async toPng(): Promise<Uint8Array> {
    this.commitText();
    const blob = await new Promise<Blob | null>(r => this.canvas.toBlob(r, 'image/png'));
    if (!blob) throw new Error('Could not encode the image');
    return new Uint8Array(await blob.arrayBuffer());
  }

  /** Scales the canvas to fit the stage, keeping its aspect ratio. */
  fit(): void {
    const w = this.canvas.width, h = this.canvas.height;
    if (!w || !h) return;
    const sw = this.stage.clientWidth - 32, sh = this.stage.clientHeight - 32;
    const scale = Math.max(0.05, Math.min(sw / w, sh / h, 2));
    this.canvas.style.width = Math.floor(w * scale) + 'px';
    this.canvas.style.height = Math.floor(h * scale) + 'px';
  }

  // ---------- history ----------

  private restore(src: HTMLCanvasElement): void {
    this.canvas.width = src.width;
    this.canvas.height = src.height;
    this.ctx.drawImage(src, 0, 0);
    this.fit();
    this.onChange();
  }

  private commit(before: HTMLCanvasElement): void {
    this.undoStack.push(before);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
    this.onChange();
  }

  // ---------- drawing ----------

  /** Stroke width relative to the image, so marks look the same on any resolution. */
  private get lineWidth(): number {
    return Math.max(3, Math.round(Math.min(this.canvas.width, this.canvas.height) / 150));
  }

  private get fontSize(): number {
    return Math.max(16, Math.round(Math.min(this.canvas.width, this.canvas.height) / 18));
  }

  private toImage(ev: PointerEvent | MouseEvent): Point {
    const r = this.canvas.getBoundingClientRect();
    const x = ((ev.clientX - r.left) * this.canvas.width) / r.width;
    const y = ((ev.clientY - r.top) * this.canvas.height) / r.height;
    return [Math.min(Math.max(x, 0), this.canvas.width), Math.min(Math.max(y, 0), this.canvas.height)];
  }

  private onDown(ev: PointerEvent): void {
    if (ev.button !== 0) return;
    if (this.tool === 'text') { this.startText(ev); return; }
    this.commitText();
    try { this.canvas.setPointerCapture(ev.pointerId); } catch { /* keep drawing without capture */ }
    const p = this.toImage(ev);
    this.drag = { start: p, points: [p], base: copyCanvas(this.canvas) };
  }

  private onMove(ev: PointerEvent): void {
    if (!this.drag) return;
    const p = this.toImage(ev);
    this.drag.points.push(p);
    this.ctx.drawImage(this.drag.base, 0, 0);
    this.drawShape(this.drag.start, p, this.drag.points, true);
  }

  private onUp(ev: PointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    const end = this.toImage(ev);
    const r = rectOf(drag.start, end);
    const moved = r.w > 3 || r.h > 3 || drag.points.length > 2;
    this.ctx.drawImage(drag.base, 0, 0);
    if (!moved) return;
    if (this.tool === 'crop') {
      if (r.w < 8 || r.h < 8) return;
      this.canvas.width = Math.round(r.w);
      this.canvas.height = Math.round(r.h);
      this.ctx.drawImage(drag.base, r.x, r.y, r.w, r.h, 0, 0, this.canvas.width, this.canvas.height);
      this.fit();
    } else {
      this.drawShape(drag.start, end, drag.points, false);
    }
    this.commit(drag.base);
  }

  private drawShape(a: Point, b: Point, points: Point[], preview: boolean): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = this.color;
    ctx.lineWidth = this.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const r = rectOf(a, b);
    switch (this.tool) {
      case 'pen':
        ctx.beginPath();
        points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
        break;
      case 'arrow':
        this.drawArrow(a, b);
        break;
      case 'rect':
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        break;
      case 'pixelate':
        this.pixelate(r.x, r.y, r.w, r.h);
        break;
      case 'crop':
        if (preview) {
          // Dim everything outside the crop area.
          ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
          ctx.beginPath();
          ctx.rect(0, 0, this.canvas.width, this.canvas.height);
          ctx.rect(r.x, r.y, r.w, r.h);
          ctx.fill('evenodd');
          ctx.setLineDash([this.lineWidth * 2, this.lineWidth * 2]);
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = Math.max(1, this.lineWidth / 2);
          ctx.strokeRect(r.x, r.y, r.w, r.h);
        }
        break;
      case 'text':
        break;
    }
    ctx.restore();
  }

  private drawArrow([x0, y0]: Point, [x1, y1]: Point): void {
    const ctx = this.ctx;
    const angle = Math.atan2(y1 - y0, x1 - x0);
    const head = Math.max(this.lineWidth * 4, 14);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    for (const side of [-1, 1]) {
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - head * Math.cos(angle + side * 0.45), y1 - head * Math.sin(angle + side * 0.45));
    }
    ctx.stroke();
  }

  /** Replaces a region with coarse blocks, e.g. to hide card numbers. */
  private pixelate(x: number, y: number, w: number, h: number): void {
    if (w < 2 || h < 2) return;
    const block = Math.max(6, Math.round(Math.min(this.canvas.width, this.canvas.height) / 40));
    const tw = Math.max(1, Math.ceil(w / block)), th = Math.max(1, Math.ceil(h / block));
    const tmp = document.createElement('canvas');
    tmp.width = tw;
    tmp.height = th;
    tmp.getContext('2d')!.drawImage(this.canvas, x, y, w, h, 0, 0, tw, th);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(tmp, 0, 0, tw, th, x, y, w, h);
    this.ctx.imageSmoothingEnabled = true;
  }

  // ---------- text ----------

  private startText(ev: PointerEvent): void {
    this.commitText();
    const [x, y] = this.toImage(ev);
    const rect = this.canvas.getBoundingClientRect();
    const stageRect = this.stage.getBoundingClientRect();
    const scale = rect.width / this.canvas.width;
    const input = document.createElement('input');
    input.className = 'absolute z-[5] min-w-[120px] -translate-y-1/2 select-text border border-dashed border-white bg-black/25 px-0.5 font-semibold outline-none [font-family:var(--sans)]';
    input.style.left = ev.clientX - stageRect.left + 'px';
    input.style.top = ev.clientY - stageRect.top + 'px';
    input.style.fontSize = this.fontSize * scale + 'px';
    input.style.color = this.color;
    input.dataset.x = String(x);
    input.dataset.y = String(y);
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') this.commitText();
      else if (e.key === 'Escape') this.cancelText();
    });
    input.addEventListener('blur', () => this.commitText());
    this.stage.appendChild(input);
    this.textInput = input;
    setTimeout(() => input.focus());
    ev.preventDefault();
  }

  private commitText(): void {
    const input = this.textInput;
    if (!input) return;
    this.textInput = null;
    const text = input.value.trim();
    input.remove();
    if (!text) return;
    const before = copyCanvas(this.canvas);
    const ctx = this.ctx;
    const size = this.fontSize;
    ctx.save();
    ctx.font = `600 ${size}px "Inter", "Segoe UI", sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, size / 6);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)'; // outline keeps text readable on any background
    ctx.strokeText(text, Number(input.dataset.x), Number(input.dataset.y));
    ctx.fillStyle = this.color;
    ctx.fillText(text, Number(input.dataset.x), Number(input.dataset.y));
    ctx.restore();
    this.commit(before);
  }

  private cancelText(): void {
    const input = this.textInput;
    this.textInput = null; // before remove(): removing fires blur, which would otherwise commit
    input?.remove();
  }
}
