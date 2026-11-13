import stylesheet from './styles.css?url';
import type { KudDiceEnvelope } from '../../contract/kud-dice';

const base = '/kud-dice/v1/';
const files = ['do.mp3', 're.mp3', 'mi.mp3', 'fa.mp3'] as const;
type Note = { pos: { x: number; y: number }; opacity: number; onUpdate(fn: () => void): void };
interface Effects {
  loadSprite(name: string, url: string): Promise<unknown>;
  add(parts: unknown[]): Note;
  sprite(name: string, options: { width: number; height: number }): unknown;
  pos(x: number, y: number): unknown; anchor(value: string): unknown;
  opacity(value: number): unknown; rotate(value: number): unknown;
  rand(min: number, max: number): number; dt(): number; destroy(note: Note): void; quit(): void;
}
type Kaboom = (options: Record<string, unknown>) => Effects;
let vendor: Promise<Kaboom> | undefined;
function loadVendor(): Promise<Kaboom> {
  return vendor ??= new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = `${base}kaboom.js`;
    script.onload = () => { const factory = (window as Window & { kaboom?: Kaboom }).kaboom;
      if (factory) resolve(factory); else reject(new Error('KABOOM_MISSING')); };
    script.onerror = () => { vendor = undefined; script.remove(); reject(new Error('KABOOM_LOAD_FAILED')); };
    document.head.append(script);
  });
}

/** Original scene, isolated from the application stylesheet and document IDs. */
export class KudDiceView {
  readonly host = document.createElement('div');
  readonly root = this.host.attachShadow({ mode: 'open' });
  readonly stage: HTMLDivElement;
  readonly audio: KudDiceEnvelope['audio'] = { source: null, missingFiles: [] };
  private abort = new AbortController();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private effects?: Effects;
  private audioContext?: AudioContext;
  private buffers: (AudioBuffer | undefined)[] = [];
  private masks: HTMLCanvasElement[] = [];
  private fonts: FontFace[] = [];
  private where: 'lab' | 'music' = 'lab';
  private talkingTimer?: ReturnType<typeof setTimeout>;
  private safari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
  onTap?: (drum: number, event: PointerEvent) => void;
  constructor(private incident: (type: KudDiceEnvelope['incidents'][number]['type'], detail: string) => void) {
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = stylesheet;
    this.stage = document.createElement('div'); this.stage.id = 'stage';
    // Static, trusted template copied from the pinned original; no participant input.
    this.stage.innerHTML = `
      <img id="bgLab" class="layer full" src="${base}escenario-laboratorio.webp" alt="">
      <img id="bgMusic" class="layer full hidden" src="${base}escenario-musical.webp" alt="">
      <div id="kud" class="layer lab"><img id="kudIdle" src="${base}kud-quieto.png" alt="Kud">
        <video id="kudTalk" class="hidden" muted loop playsinline preload="auto" src="${base}kud-hablando.webm"></video>
        <img id="kudTalkImg" class="hidden" alt=""></div>
      <img id="shipFront" class="layer hidden" src="${base}nave-frente-musical.png" alt="">
      <div id="drums" class="hidden">${['rojo', 'azul', 'amarillo', 'verde'].map((color, i) => `<img id="drum${i}" class="drum disabled" src="${base}tambor-${color}.png" alt="Tambor ${color}" draggable="false">`).join('')}</div>
      <canvas id="fx"></canvas><div id="labText" class="bubbleText fade"></div>
      <div id="musicText" class="bubbleText fade hidden"></div><div id="taps"></div><div id="buttons"></div>
      <video id="transition" class="layer full hidden" muted playsinline preload="auto"><source src="${base}transicion-lab-a-musica.webm" type="video/webm"><source src="${base}transicion-lab-a-musica.mp4" type="video/mp4"></video>
      <video id="transitionBack" class="layer full hidden" muted playsinline preload="auto"><source src="${base}transicion-musica-a-lab.webm" type="video/webm"><source src="${base}transicion-musica-a-lab.mp4" type="video/mp4"></video>
      <div id="loading">Cargando…</div>`;
    this.root.append(link, this.stage);
    for (const video of this.stage.querySelectorAll('video')) video.muted = true;
    if (this.safari) this.get<HTMLImageElement>('kudTalkImg').src = `${base}kud-hablando.webp`;
    for (let i = 0; i < 4; i++) this.get(`drum${i}`).addEventListener('pointerdown', event => {
      const pointer = event as PointerEvent; pointer.preventDefault();
      if (this.hit(i, pointer)) this.onTap?.(i, pointer);
    }, { signal: this.abort.signal });
  }
  private get<T extends HTMLElement = HTMLElement>(id: string): T { return this.root.getElementById(id) as T; }
  private later(fn: () => void, ms: number) {
    const timer = setTimeout(() => { this.timers.delete(timer); if (!this.abort.signal.aborted) fn(); }, ms);
    this.timers.add(timer); return timer;
  }
  async preflight() {
    this.fonts = [500, 600].map(weight => new FontFace('Fredoka', `url(${base}fredoka-${weight}.ttf)`, { weight: String(weight) }));
    await Promise.all(this.fonts.map(async font => { await font.load(); document.fonts.add(font); }));
    const images = [...this.stage.querySelectorAll('img')].filter(img => img.src);
    await Promise.all(images.map(img => img.decode()));
    const factory = await loadVendor();
    if (this.abort.signal.aborted) throw new DOMException('Destroyed', 'AbortError');
    this.effects = factory({ canvas: this.get('fx'), width: 1920, height: 1080, stretch: true, letterbox: false,
      background: [0, 0, 0, 0], pixelDensity: Math.min(2, devicePixelRatio || 1), global: false, debug: false, backgroundAudio: true });
    await Promise.all([1, 2, 3, 4].map(i => this.effects!.loadSprite(`nota${i}`, `${base}nota-${i}.png`)));
    this.masks = [0, 1, 2, 3].map(i => {
      const img = this.get<HTMLImageElement>(`drum${i}`), canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      canvas.getContext('2d', { willReadFrequently: true })!.drawImage(img, 0, 0); return canvas;
    });
    this.get('loading').classList.add('hidden');
  }
  error(text: string) { this.get('loading').textContent = text; this.get('loading').classList.remove('hidden'); }
  private hit(i: number, event: PointerEvent) {
    const mask = this.masks[i], bounds = this.get(`drum${i}`).getBoundingClientRect();
    if (!mask?.width) return true;
    try { return mask.getContext('2d')!.getImageData(Math.floor((event.clientX - bounds.left) / bounds.width * mask.width),
      Math.floor((event.clientY - bounds.top) / bounds.height * mask.height), 1, 1).data[3] > 40; } catch { return true; }
  }
  talking(on: boolean) {
    this.get('kudIdle').classList.toggle('hidden', on);
    if (this.safari) { this.get('kudTalkImg').classList.toggle('hidden', !on); return; }
    const video = this.get<HTMLVideoElement>('kudTalk'); video.classList.toggle('hidden', !on);
    if (on) void video.play().catch(() => this.incident('resource_load_error', 'kud-hablando.webm')); else video.pause();
  }
  say(text: string, ms = 1600) {
    const box = this.get(this.where === 'lab' ? 'labText' : 'musicText');
    const span = document.createElement('span'); span.textContent = text; box.replaceChildren(span); box.classList.remove('off');
    this.talking(true); clearTimeout(this.talkingTimer); this.talkingTimer = this.later(() => this.talking(false), ms);
  }
  buttons(labels: string[]): Promise<number> {
    const box = this.get('buttons'); box.replaceChildren();
    return new Promise((resolve, reject) => {
      const abort = () => reject(new DOMException('Destroyed', 'AbortError'));
      if (this.abort.signal.aborted) { abort(); return; }
      this.abort.signal.addEventListener('abort', abort, { once: true });
      labels.forEach((label, i) => {
        const button = document.createElement('button'); button.type = 'button'; button.className = i ? 'btn alt' : 'btn'; button.textContent = label;
        button.addEventListener('click', event => { event.stopPropagation(); box.replaceChildren();
          this.abort.signal.removeEventListener('abort', abort); resolve(i); }, { once: true, signal: this.abort.signal }); box.append(button);
      });
    });
  }
  async initAudio() {
    try { this.audioContext = new AudioContext(); } catch { this.audio.source = 'none'; this.incident('audio_play_failed', 'AudioContext'); return; }
    await Promise.all(files.map(async (file, i) => {
      try { const response = await fetch(`${base}${file}`, { signal: this.abort.signal }); if (!response.ok) throw new Error('audio');
        this.buffers[i] = await this.audioContext!.decodeAudioData(await response.arrayBuffer());
      } catch { this.audio.missingFiles.push(file); }
    }));
    const n = this.buffers.filter(Boolean).length;
    this.audio.source = n === 4 ? 'files' : n === 0 ? 'synth' : 'mixed';
    if (n < 4) this.incident('resource_load_error', this.audio.missingFiles.join(','));
  }
  tone(i: number, ms: number) {
    const ctx = this.audioContext; if (!ctx) return;
    try {
      if (ctx.state === 'suspended') void ctx.resume().catch(() => this.incident('audio_play_failed', 'resume'));
      const t = ctx.currentTime, gain = ctx.createGain(); gain.connect(ctx.destination);
      if (this.buffers[i]) { const source = ctx.createBufferSource(); source.buffer = this.buffers[i]!; gain.gain.value = .8; source.connect(gain); source.start(t); return; }
      const oscillator = ctx.createOscillator(); oscillator.type = 'triangle'; oscillator.frequency.value = [261.63, 293.66, 329.63, 349.23][i];
      const duration = Math.max(.2, ms / 1000); gain.gain.setValueAtTime(.0001, t); gain.gain.exponentialRampToValueAtTime(.45, t + .015);
      gain.gain.exponentialRampToValueAtTime(.0001, t + duration); oscillator.connect(gain); oscillator.start(t); oscillator.stop(t + duration + .05);
    } catch { this.incident('audio_play_failed', 'tone'); }
  }
  light(i: number, ms: number) { this.get(`drum${i}`).classList.add('on'); this.later(() => this.get(`drum${i}`).classList.remove('on'), ms); }
  enabled(on: boolean) { for (let i = 0; i < 4; i++) this.get(`drum${i}`).classList.toggle('disabled', !on); }
  taps(total: number, done: number[]) {
    this.get('taps').replaceChildren(...Array.from({ length: total }, (_, i) => { const dot = document.createElement('i');
      if (done[i] !== undefined) dot.className = `c${done[i]}`; return dot; }));
  }
  scene(music: boolean) {
    for (const id of ['bgLab', 'labText']) this.get(id).classList.toggle('hidden', music);
    for (const id of ['bgMusic', 'shipFront', 'drums', 'musicText']) this.get(id).classList.toggle('hidden', !music);
    this.get('kud').className = `layer ${music ? 'music' : 'lab'}`; this.where = music ? 'music' : 'lab';
    if (!music) { this.get('labText').classList.remove('off'); this.taps(0, []); }
  }
  transition(back = false): Promise<void> {
    this.get(this.where === 'lab' ? 'labText' : 'musicText').classList.add('off'); this.talking(false);
    return new Promise((resolve, reject) => {
      const video = this.get<HTMLVideoElement>(back ? 'transitionBack' : 'transition'); let done = false;
      const abort = () => { video.pause(); reject(new DOMException('Destroyed', 'AbortError')); };
      this.abort.signal.addEventListener('abort', abort, { once: true });
      const finish = (why?: string) => {
        if (done) return; done = true; clearTimeout(timeout); this.abort.signal.removeEventListener('abort', abort);
        if (why) this.incident(back ? 'transition_back_skipped' : 'transition_skipped', why);
        video.classList.add('fade', 'off'); this.later(() => { video.pause(); video.classList.add('hidden'); video.classList.remove('off'); }, 400); resolve();
      };
      video.classList.remove('hidden'); video.addEventListener('ended', () => finish(), { once: true, signal: this.abort.signal });
      video.addEventListener('error', () => finish('video_error'), { once: true, signal: this.abort.signal });
      const timeout = this.later(() => finish('timeout'), 15000);
      video.currentTime = 0; void video.play().catch(() => finish('autoplay_blocked'));
      this.later(() => this.scene(!back), 300);
    });
  }
  celebrate() {
    const fx = this.effects; if (!fx) return;
    for (let i = 0; i < 9; i++) {
      const note = fx.add([fx.sprite(`nota${1 + i % 4}`, { width: 70, height: 70 }), fx.pos(960 + fx.rand(-180, 180), 640 + fx.rand(-30, 30)),
        fx.anchor('center'), fx.opacity(0), fx.rotate(fx.rand(-20, 20))]);
      const vy = fx.rand(-260, -180), vx = fx.rand(-90, 90); let life = 0;
      note.onUpdate(() => { life += fx.dt(); note.pos.x += vx * fx.dt(); note.pos.y += vy * fx.dt();
        note.opacity = life < .15 ? life / .15 : Math.max(0, 1 - (life - .6) / .5); if (life > 1.1) fx.destroy(note); });
    }
  }
  destroy() {
    this.abort.abort(); for (const timer of this.timers) clearTimeout(timer); this.timers.clear();
    for (const video of this.stage.querySelectorAll('video')) { video.pause(); video.removeAttribute('src'); for (const source of video.querySelectorAll('source')) source.remove(); video.load(); }
    this.effects?.quit(); void this.audioContext?.close().catch(() => undefined); this.host.remove();
    for (const font of this.fonts) document.fonts.delete(font);
  }
}
