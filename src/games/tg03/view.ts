import { button, el } from '../../app/dom';
import type { MentalistaContext, Preparation } from '../../contract/mentalista';
import type { MentalistaEngine } from './engine';
import './view.css';

const asset = (name: string) => `/mentalista/v1/${name}`;
export class MentalistaView {
  readonly stage = el('section', 'mentalista');
  readonly board = el('div', 'mentalista-board');
  readonly options = el('div', 'mentalista-options');
  readonly actions = el('div', 'mentalista-actions');
  readonly message = el('p', 'mentalista-message');
  readonly progress = el('p', 'mentalista-progress');
  readonly preparation: Preparation = { instructionRepeats: 0, practice: [], resourceIncidents: [] };
  private abort = new AbortController();
  private revision = -1;
  constructor(private context: MentalistaContext) {
    this.stage.setAttribute('aria-label', 'Mentalista');
    const kud = el('img', 'mentalista-kud'); kud.src = asset('kud-quieto.png'); kud.alt = 'Kud';
    const ship = el('img', 'mentalista-ship'); ship.src = asset('nave-frente.png'); ship.alt = '';
    this.message.setAttribute('role', 'status');
    this.board.tabIndex = -1;
    this.stage.append(el('h1', 'mentalista-title', 'Mentalista'), this.progress, kud, ship, this.board, this.options, this.message, this.actions);
  }
  async preflight() {
    await Promise.all(['escenario-matematico-sin-globo.webp', 'kud-quieto.png', 'nave-frente.png'].map(name => new Promise<void>((resolve, reject) => {
      const image = new Image(), timer = setTimeout(() => reject(new Error('RESOURCE_UNAVAILABLE')), 10000);
      image.onload = () => { clearTimeout(timer); resolve(); };
      image.onerror = () => { clearTimeout(timer); reject(new Error('RESOURCE_UNAVAILABLE')); }; image.src = asset(name);
    })));
  }
  async transition(phase: 'opening' | 'closing') {
    const record = (reason: Preparation['resourceIncidents'][number]['reason']) => this.preparation.resourceIncidents.push({ phase: phase === 'opening' ? 'preparation' : 'closing', type: 'transition_skipped', reason });
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { record('reduced_motion'); return; }
    const video = el('video', 'mentalista-transition'); video.muted = true; video.playsInline = true;
    video.poster = asset('poster-transicion-inicio.webp');
    const name = phase === 'opening' ? 'transicion-lab-a-matematicas' : 'transicion-matematicas-a-lab';
    for (const format of ['webm', 'mp4']) { const source = el('source'); source.src = asset(`${name}.${format}`); source.type = `video/${format}`; video.append(source); }
    this.stage.append(video);
    await new Promise<void>(resolve => {
      let settled = false;
      const done = (reason?: Preparation['resourceIncidents'][number]['reason']) => {
        if (settled) return; settled = true; clearTimeout(timer); video.pause(); video.remove(); if (reason) record(reason); resolve();
      };
      const timer = setTimeout(() => done('timeout'), 15000);
      video.addEventListener('ended', () => done(), { once: true }); video.addEventListener('error', () => done('video_error'), { once: true });
      void video.play().catch(() => done('autoplay_blocked'));
    });
  }
  instructions(onReady: () => void) {
    this.board.textContent = 'Recuerda el número';
    this.message.textContent = 'Mira el número inicial. Suma o resta lo que aparece, guardando el resultado en tu mente. Al final elige una de las cuatro respuestas.';
    this.options.replaceChildren();
    this.actions.replaceChildren(button('Leer otra vez', () => {
      if (this.preparation.instructionRepeats < 100) this.preparation.instructionRepeats++;
      this.message.focus();
    }), button('Practicar', () => { void this.practice(onReady); }, 'button primary'));
    this.message.tabIndex = -1;
  }
  private wait(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
  }
  private async practice(onReady: () => void) {
    this.actions.replaceChildren();
    const round: { round: number; items: Preparation['practice'][number]['items'][number][] } = { round: this.preparation.practice.length + 1, items: [] };
    for (const item of this.context.config.bank.practice) {
      this.progress.textContent = `Práctica · ronda ${round.round} de 2`;
      this.message.textContent = 'Esto es práctica. Puedes usar el dedo, ratón o las teclas 1, 2, 3 y 4.';
      this.options.replaceChildren(); this.board.textContent = ''; await this.wait(1000);
      for (const text of [`Comienza con ${item.start}`, ...item.ops.map(op => `${op.op === 'suma' ? 'Suma' : 'Resta'} ${op.n}`)]) {
        if (this.abort.signal.aborted) return;
        this.board.textContent = text; await this.wait(2500); this.board.textContent = ''; await this.wait(500);
      }
      this.board.textContent = '¿Qué número tienes ahora?';
      const response = await new Promise<{ selectedIdx: number | null; rtMs: number | null }>(resolve => {
        const at = performance.now(); let settled = false;
        const done = (selectedIdx: number | null) => {
          if (settled) return; settled = true; clearTimeout(timer); window.removeEventListener('keydown', key);
          resolve({ selectedIdx, rtMs: selectedIdx === null ? null : Math.min(29999, performance.now() - at) });
        };
        const timer = setTimeout(() => done(null), 30000);
        const key = (e: KeyboardEvent) => { if (!e.repeat && /^[1-4]$/.test(e.key)) { e.preventDefault(); done(Number(e.key) - 1); } };
        window.addEventListener('keydown', key, { signal: this.abort.signal });
        this.options.replaceChildren(...item.options.map((value, index) => button(String(value), () => done(index), 'mentalista-option')));
      });
      const result = response.selectedIdx === null ? 'omission' : response.selectedIdx === item.correctIdx ? 'correct' : 'incorrect';
      if (item.id !== 'P1' && item.id !== 'P2') throw new Error('INVALID_PRACTICE_BANK');
      round.items.push({ itemId: item.id, ...response, result });
      this.options.replaceChildren(); this.board.textContent = String(item.options[item.correctIdx]);
      this.message.textContent = `${result === 'correct' ? 'Así es.' : 'Veámoslo juntos.'} ${item.start} ${item.ops.map(op => `${op.op === 'suma' ? '+' : '−'} ${op.n}`).join(' ')} = ${item.options[item.correctIdx]}.`;
      await new Promise<void>(resolve => this.actions.replaceChildren(button('Continuar', () => { this.actions.replaceChildren(); resolve(); }, 'button primary')));
    }
    if (round.items.length !== 2) throw new Error('INVALID_PRACTICE_BANK');
    this.preparation.practice.push({ round: round.round, items: [round.items[0]!, round.items[1]!] });
    if (round.items.some(i => i.result !== 'correct') && round.round < 2) {
      this.board.textContent = 'Practiquemos otra vez';
      this.actions.replaceChildren(button('Segunda práctica', () => { void this.practice(onReady); }, 'button primary'));
    } else {
      this.board.textContent = 'Todo listo'; this.message.textContent = 'Ahora harás 12 ejercicios. No mostraremos si acertaste. Mantén esta actividad abierta y la pantalla en la misma posición.';
      this.actions.replaceChildren(button('Comenzar actividad', onReady, 'button primary'));
    }
  }
  draw(engine: MentalistaEngine) {
    if (engine.revision === this.revision) return; this.revision = engine.revision;
    this.stage.classList.add('mentalista-measuring'); this.message.textContent = '';
    this.progress.textContent = `Ejercicio ${engine.current.trial} de 12`;
    this.board.textContent = engine.text;
    const shown = engine.phase === 'options' || engine.phase === 'locked';
    const trial = String(engine.current.trial);
    if (!shown) this.options.replaceChildren();
    else if (this.options.dataset.trial !== trial || !this.options.children.length) {
      this.options.dataset.trial = trial;
      this.options.replaceChildren(...engine.current.optionValues.map((value, index) => {
        const control = button(String(value), () => undefined, 'mentalista-option'); control.dataset.index = String(index);
        control.setAttribute('aria-label', `Opción ${index + 1}: ${value}`); return control;
      }));
    }
    for (const node of this.options.querySelectorAll<HTMLButtonElement>('button')) {
      node.setAttribute('aria-disabled', String(engine.phase === 'locked'));
      node.classList.toggle('pressed', engine.current.selectedIdx === Number(node.dataset.index));
    }
  }
  destroy() { this.abort.abort(); }
}
