import './styles.css';

const asset = (name: string) => `/games/tg02/${name}`;
export class View {
  readonly root = document.createElement('section');
  private readonly abort = new AbortController();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private pending = new Set<() => void>();
  private where: 'lab' | 'library' = 'lab';
  private talkTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(host: HTMLElement) {
    this.root.className = 'tg02'; this.root.setAttribute('aria-label', 'Palabra Intrusa');
    // Static original composition; item words always use textContent.
    this.root.innerHTML = `<img data-part="bgLab" class="layer full" src="${asset('escenario-laboratorio.webp')}" alt="">
      <div data-part="kud" class="layer lab"><img data-part="idle" src="${asset('kud-quieto.png')}" alt="Kud">
      <video data-part="talk" class="hidden" muted loop playsinline preload="auto" src="${asset('kud-hablando.webm')}"></video>
      <img data-part="talkImage" class="hidden" src="${asset('kud-hablando.webp')}" alt=""></div>
      <div data-part="labText" class="fade" aria-live="polite"></div><div data-part="bubbleText" class="hidden" aria-live="polite"></div>
      <div data-part="cards" class="hidden">${[0, 1, 2, 3].map(i => `<button type="button" class="card c${i}" data-pos="${i}"><span class="band" aria-hidden="true"></span><span data-word></span></button>`).join('')}</div>
      <div data-part="progress" class="layer hidden" role="progressbar" aria-label="Progreso" aria-valuemin="0" aria-valuemax="18"><div data-part="progressFill"></div></div>
      <div data-part="countdown" class="layer hidden" aria-live="polite"></div><div data-part="buttons"></div>
      <video data-part="transition" class="layer full hidden" muted playsinline preload="auto"><source src="${asset('transicion-lab-a-biblioteca.webm')}" type="video/webm"><source src="${asset('transicion-lab-a-biblioteca.mp4')}" type="video/mp4"></video>
      <video data-part="transitionBack" class="layer full hidden" muted playsinline preload="auto"><source src="${asset('transicion-biblioteca-a-lab.webm')}" type="video/webm"><source src="${asset('transicion-biblioteca-a-lab.mp4')}" type="video/mp4"></video>
      <div data-part="loading" role="status">Cargando…</div>`;
    host.append(this.root);
  }
  part<T extends HTMLElement = HTMLElement>(name: string) { return this.root.querySelector<T>(`[data-part="${name}"]`)!; }
  get signal() { return this.abort.signal; }
  async load() {
    const images = ['escenario-laboratorio.webp', 'escenario-biblioteca.webp', 'kud-quieto.png'];
    await Promise.all(images.map(name => new Promise<void>((resolve, reject) => {
      const img = new Image();
      const done = (failed: boolean) => { clearTimeout(timer); this.pending.delete(cancel); img.onload = null; img.onerror = null; if (failed) reject(new Error('RESOURCE_LOAD_ERROR')); else resolve(); };
      const cancel = () => done(false), timer = setTimeout(() => done(true), 15000); this.pending.add(cancel);
      img.onload = () => done(false); img.onerror = () => done(true); img.src = asset(name);
    })));
    await Promise.all([document.fonts.load('500 20px Fredoka'), document.fonts.load('600 20px Fredoka')]);
    if (!this.signal.aborted) this.part('loading').classList.add('hidden');
  }
  wait(ms: number) {
    if (this.signal.aborted) return Promise.resolve();
    return new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); this.timers.delete(timer); this.pending.delete(done); resolve(); };
      const timer = setTimeout(done, Math.max(0, ms)); this.timers.add(timer); this.pending.add(done);
    });
  }
  private talking(on: boolean) {
    const v = this.part<HTMLVideoElement>('talk'), image = this.part('talkImage'), idle = this.part('idle');
    const safari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
    v.pause(); v.classList.add('hidden'); image.classList.add('hidden'); idle.classList.toggle('hidden', on);
    if (!on) return;
    if (safari) image.classList.remove('hidden');
    else { v.classList.remove('hidden'); void v.play().catch(() => { v.classList.add('hidden'); image.classList.remove('hidden'); }); }
  }
  say(text: string, ms = 0, talk = true) {
    const el = this.part(this.where === 'lab' ? 'labText' : 'bubbleText'); el.textContent = text; el.classList.remove('off');
    clearTimeout(this.talkTimer); this.talking(talk);
    if (talk) this.talkTimer = setTimeout(() => this.talking(false), ms || 1600);
  }
  buttons(labels: string[]) {
    const box = this.part('buttons'); box.replaceChildren();
    return new Promise<number>(resolve => {
      const cancel = () => { this.pending.delete(cancel); resolve(-1); }; this.pending.add(cancel);
      labels.forEach((label, i) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = `btn${i ? ' alt' : ''}`; b.textContent = label;
        b.addEventListener('click', e => { e.stopPropagation(); box.replaceChildren(); this.pending.delete(cancel); resolve(i); }, { signal: this.signal }); box.append(b);
      });
    });
  }
  cards(words: string[]) {
    const box = this.part('cards'); box.classList.remove('hidden', 'off', 'locked');
    words.forEach((word, i) => { const card = box.querySelector<HTMLElement>(`[data-pos="${i}"]`)!;
      card.classList.remove('sel', 'good'); card.querySelector('[data-word]')!.textContent = word; });
  }
  select(index: number | null, correct?: number) {
    this.part('cards').classList.add('locked');
    if (index !== null) this.root.querySelector(`[data-pos="${index}"]`)!.classList.add('sel');
    if (correct !== undefined) this.root.querySelector(`[data-pos="${correct}"]`)!.classList.add('good');
  }
  hideCards() { this.part('cards').classList.add('off', 'locked'); }
  progress(n: number) { this.part('progress').classList.remove('hidden'); this.part('progress').setAttribute('aria-valuenow', String(n)); this.part('progressFill').style.width = `${n / 18 * 100}%`; }
  scene(library: boolean) {
    this.where = library ? 'library' : 'lab'; this.part('bgLab').classList.toggle('hidden', library);
    this.part('labText').classList.toggle('hidden', library); this.part('bubbleText').classList.toggle('hidden', !library);
    this.part('kud').className = `layer ${this.where}`;
  }
  async transition(back = false): Promise<boolean> {
    this.talking(false); const video = this.part<HTMLVideoElement>(back ? 'transitionBack' : 'transition');
    video.classList.remove('hidden'); video.currentTime = 0;
    let skipped = false;
    await new Promise<void>(resolve => {
      let settled = false;
      const done = (failed: boolean) => { if (settled) return; settled = true; skipped = failed; clearTimeout(timer); video.removeEventListener('ended', ended); video.removeEventListener('error', error); this.pending.delete(cancel); resolve(); };
      const ended = () => done(false), error = () => done(true), cancel = () => done(true);
      const timer = setTimeout(error, 15000); this.pending.add(cancel);
      video.addEventListener('ended', ended, { once: true }); video.addEventListener('error', error, { once: true });
      void video.play().catch(error);
    });
    video.pause(); video.classList.add('hidden'); this.scene(!back); return skipped;
  }
  destroy() { this.abort.abort(); for (const done of [...this.pending]) done(); for (const timer of this.timers) clearTimeout(timer); clearTimeout(this.talkTimer); this.root.querySelectorAll('video').forEach(v => v.pause()); this.root.remove(); }
}
