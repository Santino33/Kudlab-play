import { Engine } from './engine';
// Both silhouettes fill a 100×100 bounding box: at scale .6 a size-75 target is visibly 45px.
export const STAR_PATH = 'M50 0 65 33 100 38 74.5 63.4 80.5 100 50 82.6 19.5 100 25.5 63.4 0 38 35 33Z';
export const MOON_PATH = 'M100 0C-33.3333333333 0-33.3333333333 100 100 100C20 100 20 0 100 0Z';
export function drawShape(ctx: CanvasRenderingContext2D, type: 'star' | 'moon', x: number, y: number, size: number): void {
  ctx.save(); ctx.translate(x - size / 2, y - size / 2); ctx.scale(size / 100, size / 100);
  ctx.fillStyle = type === 'star' ? '#f8d278' : '#e8f0ef';
  ctx.fill(new Path2D(type === 'star' ? STAR_PATH : MOON_PATH)); ctx.restore();
}
export class CanvasView {
  readonly ctx: CanvasRenderingContext2D;
  constructor(readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('CANVAS_UNAVAILABLE');
    this.ctx = ctx;
  }
  resize(widthCss: number, heightCss: number): void {
    const dpr = Math.min(devicePixelRatio || 1, 3);
    this.canvas.width = Math.round(widthCss * dpr); this.canvas.height = Math.round(heightCss * dpr);
  }
  draw(engine: Engine): void {
    const { logicalWidth, logicalHeight } = engine.config;
    this.ctx.setTransform(this.canvas.width / logicalWidth, 0, 0, this.canvas.height / logicalHeight, 0, 0);
    this.ctx.fillStyle = '#192e30'; this.ctx.fillRect(0, 0, logicalWidth, logicalHeight);
    for (const t of engine.visible()) drawShape(this.ctx, t.stimulus, t.geometry.x, engine.y(t), t.geometry.size);
  }
}
