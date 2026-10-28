import { Api, ApiError } from '../delivery/api';
import { Delivery, type DeliveryState } from '../delivery/outbox';
import { Session, type Credential } from '../runtime/session';
import { Database } from '../storage/database';
import { Journal, type Outbox, type Snapshot } from '../evidence/journal';
import { type SessionContext, type TerminationReason, uuidV4, VIEWPORT_PROFILE, isViewportConfig } from '../contract/schema';
import { Engine, resolveConfig, stageLayout } from '../games/tg01/engine';
import { CanvasView } from '../games/tg01/canvas';
import { SupervisedBridge } from '../bridge/supervised';
import { registry, supported } from '../games/registry';
import { button, el, shape } from './dom';
import { countdown } from './countdown';

type Screen = 'access' | 'pending' | 'instructions' | 'example' | 'running' | 'finish';
export class App {
  private db?: Database;
  private session?: Session;
  private delivery?: Delivery;
  private bridge?: SupervisedBridge;
  private context?: SessionContext;
  private engine?: Engine;
  private journal?: Journal;
  private screen: Screen = 'instructions';
  private ready = false;
  private starting = false;
  private countdownValue: number | null = null;
  private countdownAbort?: AbortController;
  private countdownStopReason: TerminationReason | null = null;
  private claiming = false;
  private maintenanceBusy = false;
  private closing = false;
  private launchBound = false;
  private bridgeId = new URLSearchParams(location.search).get('bridgeId');
  private updateAvailable = false;
  private status = 'Preparando tu actividad…';
  private problem = '';
  private storagePersistent = false;
  private pendingCount = 0;
  private deliveryState: DeliveryState = 'PENDING';
  private lastOut?: Outbox;
  private memoryOnly = false;
  private owner = crypto.randomUUID();
  private queue: Promise<void> = Promise.resolve();
  private lastQueuedAt = 0;
  private lastRevision = -1;
  private queuedWrites = 0;
  private raf = 0;
  private gameAbort?: AbortController;
  private leaseTimer?: ReturnType<typeof setInterval>;
  private maintenanceTimer?: ReturnType<typeof setInterval>;
  private main = el('main', 'main');
  private live = el('p', 'sr-only');
  private startButton?: HTMLButtonElement;
  private reasonNode?: HTMLElement;
  private exampleTimers: ReturnType<typeof setTimeout>[] = [];
  private api = new Api(import.meta.env.VITE_API_ORIGIN || 'https://api.invalid');
  private publicEntry = window.parent === window;
  private pendingItems: Outbox[] = [];
  private pendingSignature = '';
  private retryCodeAt = 0;

  constructor(private root: HTMLElement) {}
  async init(): Promise<void> {
    if (this.publicEntry) this.screen = location.pathname === '/pendientes' ? 'pending' : 'access';
    this.live.setAttribute('role', 'status'); this.live.setAttribute('aria-live', 'polite');
    const header = el('header', 'header');
    const brand = el('div', 'brand'); brand.append(shape('star'), el('span', '', 'Kudlab'), el('span', 'brand-play', 'Play'));
    const help = button('Ayuda', () => this.help(), 'button quiet');
    header.append(brand, help);
    const footer = el('footer', 'footer');
    footer.append(el('span', '', 'Un momento para mirar y tocar.'), el('span', '', 'Actividad acompañada'));
    this.root.replaceChildren(header, this.main, footer, this.live);
    this.render();
    window.addEventListener('online', () => { this.refreshAvailability(); void this.maintain(true); });
    window.addEventListener('offline', () => this.refreshAvailability());
    window.addEventListener('resize', () => this.refreshAvailability());
    window.addEventListener('runtime-update-available', () => {
      this.updateAvailable = true;
      if (this.screen !== 'running' && !this.starting) this.render();
    });
    try {
      if (!isSecureContext || !crypto.subtle) throw new Error('SECURE_CONTEXT_REQUIRED');
      if (!document.createElement('canvas').getContext('2d')) throw new Error('CANVAS_UNAVAILABLE');
      await document.fonts.ready;
      if (!document.fonts.check('400 16px Nunito')) throw new Error('RESOURCE_UNAVAILABLE');
      this.db = await Database.open();
      this.storagePersistent = (await this.db.preflight()).persistent;
      this.session = new Session(this.db, this.api, this.owner);
      this.delivery = new Delivery(this.db, this.api, this.owner);
      this.ready = true;
      this.status = this.publicEntry ? '' : 'Pide a tu profesor que abra la actividad desde Kudlab.';
      await this.maintain();
      const bridgeId = this.bridgeId;
      if (!this.publicEntry && uuidV4.safeParse(bridgeId).success) {
        const origin = import.meta.env.VITE_TEACHER_ORIGIN || 'https://docente.invalid';
        this.bridge = new SupervisedBridge(origin, bridgeId!);
        this.bridge.connect(grant => { void this.claim(grant); });
        const recoverySessionId = new URLSearchParams(location.search).get('recoverySessionId');
        if (uuidV4.safeParse(recoverySessionId).success) {
          const out = await this.db.get<Outbox>('outbox', recoverySessionId!);
          if (out) this.bridge.notify('RECOVERY_REQUESTED', out.sessionId, out.envelope.submissionId);
          else this.bridge.recoveryUnavailable(recoverySessionId!);
        }
      }
      this.maintenanceTimer = setInterval(() => { void this.maintain(); }, 1500);
      this.render();
    } catch {
      this.ready = false;
      this.problem = 'No podemos preparar un respaldo en este navegador. Pide ayuda a tu profesor; prueba la misma actividad en otro navegador o dispositivo.';
      this.status = 'No se ha iniciado ninguna actividad.';
      this.render();
    }
  }
  private say(message: string): void { this.live.textContent = message; }
  private layout() {
    const config = this.context?.config ?? VIEWPORT_PROFILE;
    return isViewportConfig(config) ? stageLayout(innerWidth, Math.max(0, innerHeight - 72), config)
      : stageLayout(Math.max(0, innerWidth - (innerWidth < 640 ? 32 : 64)), Math.max(0, innerHeight - 180), config);
  }
  private unavailable(): string {
    if (!this.ready) return this.problem || 'Estamos comprobando los recursos y el respaldo local.';
    if (this.starting) return this.countdownValue === null ? 'Confirmando el inicio con tu profesor…' : 'Prepárate. La actividad está por comenzar.';
    if (!this.layout().supported) return isViewportConfig(this.context?.config ?? VIEWPORT_PROFILE)
      ? 'Necesitamos al menos 288 × 240 píxeles para mostrar las formas. Amplía la ventana o pide ayuda a tu profesor.'
      : 'Esta autorización usa el perfil anterior de pantalla grande. Pide a tu profesor una actividad adaptable al teléfono.';
    if (!navigator.onLine) return 'Para comenzar necesitamos conexión a internet.';
    if (this.problem) return this.problem;
    if (!this.context?.capabilities.canStart) return this.status;
    return '';
  }
  private refreshAvailability(): void {
    const reason = this.unavailable();
    if (this.startButton) this.startButton.disabled = Boolean(reason);
    if (this.reasonNode) this.reasonNode.textContent = reason || 'Tu actividad está lista';
  }
  private async claim(grant: string): Promise<void> {
    if (this.claiming || this.starting || this.engine || this.launchBound) return;
    this.claiming = true;
    this.status = 'Confirmando tu actividad con el profesor…'; this.refreshAvailability();
    try {
      this.context = await this.session!.claim(grant, this.bridgeId ?? undefined);
      if (!supported(this.context)) throw new Error('VERSION_UNSUPPORTED');
      const credential = await this.db!.get<Credential>('credentials', this.context.sessionId);
      if (credential) await this.db!.put('credentials', { ...credential, bridgeId: this.bridgeId ?? undefined });
      this.launchBound = true;
      this.lastOut = undefined; this.deliveryState = 'PENDING'; this.screen = 'instructions';
      this.problem = ''; this.status = 'Tu actividad está lista';
      if (!this.context.capabilities.canStart && this.context.capabilities.canSubmit) {
        this.lastOut = await this.db!.get<Outbox>('outbox', this.context.sessionId);
        this.screen = 'finish'; this.status = 'Recuperando el envío guardado en este navegador.';
        void this.maintain(true);
      }
      this.render();
      this.say(this.status);
    } catch (error) {
      this.status = error instanceof Error && error.message === 'LOCAL_EVIDENCE_NOT_FOUND'
        ? 'No encontramos el envío en este navegador. Vuelve al mismo sitio, dispositivo y perfil donde realizaste la actividad. No se iniciará otra partida.'
        : 'No pudimos confirmar la autorización. Comprueba la conexión y pide ayuda a tu profesor.';
    } finally { this.claiming = false; this.refreshAvailability(); }
  }
  private async maintain(force = false): Promise<void> {
    if (!this.db || !this.session || !this.delivery || this.maintenanceBusy || this.engine?.running || this.starting || this.claiming || this.closing) return;
    this.maintenanceBusy = true;
    try {
      if (navigator.onLine) await this.session.reconcileClaims().catch(() => undefined);
      await this.session.recoverStarted();
      const credentials = await this.db.all<Credential>('credentials');
      if (!this.publicEntry && !this.context && uuidV4.safeParse(this.bridgeId).success) {
        this.context = credentials.find(c => c.phase === 'READY' && c.bridgeId === this.bridgeId && c.context?.capabilities.canStart)?.context;
        if (this.context) this.launchBound = true;
        if (this.context && this.screen === 'finish' && !this.engine && this.context.sessionId !== this.lastOut?.sessionId) {
          this.screen = 'instructions'; this.lastOut = undefined; this.deliveryState = 'PENDING'; this.render();
        }
      }
      const outboxes = await this.db.all<Outbox>('outbox');
      this.pendingCount = outboxes.length;
      for (const out of outboxes) {
        // Public UI never lists sessions or selects the next student's capability for old evidence.
        if (navigator.onLine && !document.hidden) {
          const state = await this.delivery.send(out.sessionId, force);
          if (this.lastOut?.sessionId === out.sessionId) this.updateDelivery(state);
        }
      }
      if (!this.publicEntry && !this.context && outboxes.length && this.screen === 'instructions') {
        this.lastOut = outboxes[0]; this.deliveryState = (await this.db.get<Outbox>('outbox', outboxes[0].sessionId))?.status ?? 'SAVED';
        this.screen = 'finish'; this.render();
      }
      if (this.publicEntry) {
        this.pendingItems = await this.db.all<Outbox>('outbox');
        const signature = this.pendingItems.map(o => `${o.key}:${o.status}`).join('|');
        if (signature !== this.pendingSignature && this.screen === 'pending' && !this.main.querySelector('input:focus')) { this.pendingSignature = signature; this.render(); }
      }
      // A verified receipt can survive a failed cleanup; retry cleanup while preserving remote success.
      const receipts = await this.db.all<{ key: string; expiresAt: number }>('receipts');
      for (const receipt of receipts) if (receipt.expiresAt < Date.now() && !await this.db.get('outbox', receipt.key)) await this.db.remove('receipts', receipt.key);
      this.refreshAvailability();
    } catch {
      if (this.screen === 'instructions') { this.status = 'La recuperación necesita conexión o ayuda de tu profesor.'; this.refreshAvailability(); }
    } finally { this.maintenanceBusy = false; }
  }
  private render(focus = false): void {
    for (const timer of this.exampleTimers) clearTimeout(timer);
    this.exampleTimers = [];
    this.main.replaceChildren(); this.startButton = undefined; this.reasonNode = undefined;
    if (this.screen === 'access') this.accessScreen();
    else if (this.screen === 'pending') this.pendingScreen();
    else if (this.screen === 'instructions') this.instructions();
    else if (this.screen === 'example') this.example();
    else if (this.screen === 'finish') this.finishScreen();
    if (this.updateAvailable) this.main.append(el('p', 'update-note', 'Hay una versión nueva. Al terminar, cierra todas las pestañas de la actividad y vuelve a abrirla. Los envíos pendientes se conservan.'));
    if (focus) { const title = this.main.querySelector('h1'); title?.setAttribute('tabindex', '-1'); title?.focus(); }
  }
  private publicLink(path: '/' | '/pendientes', text: string): HTMLAnchorElement {
    const link = el('a', 'button secondary', text); link.href = path; return link;
  }
  private accessForm(recovery?: Outbox): HTMLFormElement {
    const form = el('form', 'access-form'); form.noValidate = true;
    const id = `activity-code-${recovery?.key ?? 'entry'}`;
    const label = el('label', '', recovery ? 'Código para enviar' : 'Código de actividad'); label.htmlFor = id;
    const input = el('input', 'code-input'); input.id = id; input.name = 'activity-code'; input.type = 'text'; input.autocomplete = 'off'; input.autocapitalize = 'characters'; input.spellcheck = false; input.maxLength = 64; input.required = true; input.disabled = !this.ready;
    const help = el('p', 'access-help', 'Son 5 letras o números. Puedes pegar el código que te compartió tu profesor.'); help.id = `${id}-help`;
    const feedback = el('p', 'availability'); feedback.id = `${id}-feedback`; feedback.setAttribute('role', 'status');
    input.setAttribute('aria-describedby', `${help.id} ${feedback.id}`);
    const submit = button(recovery ? 'Enviar pendiente' : 'Continuar', () => undefined, 'button primary'); submit.type = 'submit'; submit.disabled = !this.ready;
    const clear = () => { input.value = ''; };
    window.addEventListener('pagehide', clear);
    const hide = () => { if (document.hidden) clear(); };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('blur', clear);
    // Remove handlers when this form leaves the document, without retaining its secret input.
    const observer = new MutationObserver(() => { if (!form.isConnected) { document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', clear); window.removeEventListener('blur', clear); observer.disconnect(); } });
    observer.observe(this.main, { childList: true });
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (this.claiming || !this.ready || !this.session) return;
      if (Date.now() < this.retryCodeAt) { feedback.textContent = `Espera ${Math.ceil((this.retryCodeAt - Date.now()) / 1000)} segundos antes de reintentar.`; return; }
      if (!navigator.onLine) { feedback.textContent = 'Necesitamos conexión para comprobar el código.'; return; }
      const value = input.value;
      this.claiming = true; submit.disabled = true; feedback.textContent = 'Comprobando el código…';
      void this.session.claimCode(value, recovery ? { sessionId: recovery.sessionId, submissionId: recovery.envelope.submissionId } : undefined).then(async context => {
        clear();
        if (!supported(context)) throw new Error('VERSION_UNSUPPORTED');
        if (recovery) {
          this.context = undefined; this.lastOut = undefined;
          feedback.textContent = 'Autorización de envío confirmada. Comprobando recepción…';
          await this.delivery!.send(recovery.sessionId, true);
          this.pendingItems = await this.db!.all<Outbox>('outbox'); this.render(); this.say(this.pendingItems.some(o => o.sessionId === recovery.sessionId) ? 'El registro sigue pendiente.' : 'El servidor confirmó la recepción.');
        } else {
          this.context = context; this.launchBound = true; this.lastOut = undefined; this.deliveryState = 'PENDING'; this.screen = 'instructions'; this.status = 'Tu actividad está lista'; this.problem = ''; this.render(true);
        }
      }).catch(error => {
        input.setAttribute('aria-invalid', 'true');
        if (error instanceof ApiError && error.status === 429) { this.retryCodeAt = Date.now() + error.retryAfterMs; feedback.textContent = `Espera ${Math.max(1, Math.ceil(error.retryAfterMs / 1000))} segundos antes de reintentar.`; }
        else if (error instanceof ApiError && (error.status === 0 || error.status >= 500) || error instanceof Error && error.message === 'ONLINE_REQUIRED') feedback.textContent = 'No pudimos comprobarlo. Reintenta cuando tengas conexión. Si recargas, vuelve a ingresar el mismo código.';
        else if (error instanceof Error && error.message === 'INVALID_CODE') feedback.textContent = 'Escribe las 5 letras o números del código, sin cambiar unos caracteres por otros.';
        else feedback.textContent = recovery ? 'No podemos enviar este pendiente con ese código. Pide ayuda a tu profesor; conserva este navegador.' : 'No podemos abrir una actividad con este código. Revísalo o pide ayuda a tu profesor. Para enviar resultados usa «Enviar una actividad pendiente».';
      }).finally(() => { this.claiming = false; submit.disabled = false; });
    });
    input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
    form.append(label, input, help, submit, feedback); return form;
  }
  private accessScreen(): void {
    const section = el('section', 'access-sheet');
    section.append(el('h1', '', 'Tu actividad empieza aquí'), el('p', 'intro-copy', 'Ingresa el código que te compartió tu profesor.'), this.accessForm(), this.publicLink('/pendientes', 'Enviar una actividad pendiente'));
    if (!this.ready) section.append(el('p', 'availability', this.problem || 'Comprobando el respaldo de este navegador…'));
    section.append(el('p', 'access-help', 'No necesitas una cuenta ni escribir tu nombre. No compartas tu código.'));
    this.main.append(section);
  }
  private pendingScreen(): void {
    this.main.append(el('h1', '', 'Actividades pendientes'), el('p', 'intro-copy', 'Solo podemos enviar lo que conserva este navegador. No necesitas volver a jugar.'), this.publicLink('/', 'Ingresar otro código'));
    if (!this.ready) { this.main.append(el('p', 'availability', this.problem || 'Comprobando el respaldo local…')); return; }
    if (!this.pendingItems.length) { this.main.append(el('p', 'delivery-note', 'En este navegador no encontramos resultados pendientes. Si jugaste en otro sitio, perfil o dentro de Kudlab, vuelve por esa misma vía.')); return; }
    const list = el('ul', 'pending-list');
    for (const out of this.pendingItems) {
      const row = el('li', 'pending-row');
      row.append(el('h2', '', 'Lluvia de estrellas'), el('p', '', `Fecha informativa del dispositivo: ${new Date(out.envelope.clock.timeOriginUnixMs).toLocaleString('es-CO')}`));
      row.append(el('p', '', out.status === 'AUTH_REQUIRED' || out.status === 'BLOCKED' ? 'El envío necesita una autorización de tu profesor.' : 'Hay un respaldo local; falta confirmar la recepción.'));
      if (out.status === 'AUTH_REQUIRED' || out.status === 'BLOCKED') row.append(this.accessForm(out));
      else row.append(button('Reintentar envío', () => { void this.maintain(true); }));
      list.append(row);
    }
    this.main.append(list, el('p', 'access-help', 'No borres los datos del sitio. Si no corresponde el código, no seleccionaremos otra actividad automáticamente.'));
  }
  private instructions(): void {
    const intro = el('div', 'intro');
    intro.append(el('h1', '', 'Lluvia de estrellas'), el('p', 'intro-copy', 'Antes de empezar, mira lo que vamos a hacer.'));
    const sheet = el('section', 'instruction-sheet'); sheet.setAttribute('aria-label', 'Instrucciones de la actividad');
    const words = el('div', 'instruction-words');
    const first = el('div', 'instruction-rule'); first.append(el('h2', '', 'Toca las estrellas.'), el('p', '', 'Cuando veas una, tócala una vez.'));
    const second = el('div', 'instruction-rule'); second.append(el('h2', '', 'Deja pasar las lunas.'), el('p', '', 'Las lunas siguen su camino. No las toques.'));
    const exampleButton = button('Ver el ejemplo', () => { this.screen = 'example'; this.render(true); });
    words.append(first, second, exampleButton);
    const picture = el('div', 'instruction-picture');
    const star = el('div', 'figure-star'); star.append(shape('star'), el('span', '', 'Esta sí'));
    const moon = el('div', 'figure-moon'); moon.append(shape('moon'), el('span', '', 'Esta no'));
    picture.append(star, moon); sheet.append(words, picture);
    const launch = el('section', 'launch-area'); launch.setAttribute('aria-label', 'Preparación e inicio');
    const text = el('div', 'launch-text');
    text.append(el('h2', '', '¿Todo listo?'), el('p', '', 'La actividad dura 2 minutos. Busca una posición cómoda.'));
    this.reasonNode = el('p', 'availability'); this.reasonNode.id = 'start-reason';
    this.startButton = button('Comenzar', () => { void this.begin(); }, 'button primary');
    this.startButton.setAttribute('aria-describedby', 'start-reason');
    launch.append(text, this.startButton);
    const note = el('p', 'support-note', 'Puedes usar un ratón, el dedo o un lápiz táctil. La actividad necesita apuntar a las formas.');
    const details = el('details', 'preparation-details');
    details.append(el('summary', '', 'Sobre el respaldo y el dispositivo'));
    details.append(el('p', '', this.ready ? `El almacenamiento local está disponible.${this.storagePersistent ? ' El navegador concedió persistencia.' : ' El navegador no garantiza conservarlo si necesita liberar espacio.'} Si se pierde la conexión después de empezar, conservaremos lo que este navegador consiga registrar. No se inicia sin autorización online.` : 'Comprobamos el almacenamiento y los recursos antes de pedir autorización de inicio.'));
    if (this.pendingCount) details.append(el('p', '', `Hay ${this.pendingCount} envío(s) pendiente(s) en este navegador. No borres los datos del sitio; cada envío conserva su propia autorización.`));
    this.main.append(intro, sheet, launch, this.reasonNode, note, details); this.refreshAvailability();
  }
  private example(): void {
    this.main.append(el('h1', '', 'Probemos juntos'), el('p', 'intro-copy', 'Esto es un ejemplo. No guarda resultados ni inicia tu actividad.'));
    const area = el('section', 'example-area'); area.setAttribute('aria-label', 'Ejemplo no evaluativo');
    const prompt = el('p', 'example-prompt', 'Toca esta estrella.');
    const target = button('', () => {
      target.disabled = true; target.classList.add('example-touched'); prompt.textContent = 'La luna pasa sola';
      const moon = el('div', 'example-moon'); moon.append(shape('moon')); area.append(moon);
      this.say('La luna pasa sola. No necesitas tocarla.');
    }, 'example-star');
    target.setAttribute('aria-label', 'Tocar la estrella del ejemplo'); target.append(shape('star'));
    area.append(prompt, target);
    const actions = el('div', 'example-actions'); actions.append(
      button('Repetir el ejemplo', () => this.render()),
      button('Volver a las instrucciones', () => { this.screen = 'instructions'; this.render(true); }, 'button primary'));
    this.main.append(area, actions);
  }
  private async begin(): Promise<void> {
    if (this.unavailable() || !this.context || !this.session || !this.db) return;
    this.starting = true; this.refreshAvailability();
    const layout = this.layout();
    const adaptive = isViewportConfig(this.context.config);
    const meta: Pick<Snapshot, 'clock' | 'device' | 'startedAtMs'> = { clock: { id: crypto.randomUUID(), timeOriginUnixMs: performance.timeOrigin },
      device: { viewportWidth: innerWidth, viewportHeight: innerHeight, stageScale: layout.scale, touchCapable: navigator.maxTouchPoints > 0,
        ...(adaptive ? { stageWidthCss: layout.width, stageHeightCss: layout.height } : {}) }, startedAtMs: performance.now() };
    const initial: Snapshot = { ...meta, checkpointAtMs: meta.startedAtMs, events: [], incidents: [], terminationReason: null };
    try {
      await this.db.preflight();
      this.journal = await this.session.start(this.context, initial);
      this.leaseTimer = setInterval(() => {
        const stop = (reason: TerminationReason) => {
          if (this.engine?.running) this.interrupt(reason);
          else { this.countdownStopReason = reason; this.countdownAbort?.abort(); }
        };
        void this.db!.lease(`execution:${this.context!.sessionId}`, this.owner).then(ok => { if (!ok) stop('script_error'); }).catch(() => stop('storage_failure'));
      }, 3000);
      const stopped = await this.countIn();
      let effective = stopped ? layout : this.layout();
      let canvas: HTMLCanvasElement | undefined;
      let stopReason = stopped;
      if (!effective.supported) { effective = layout; stopReason = 'layout_changed'; }
      if (!stopReason) {
        this.screen = 'running'; canvas = this.mountStage(effective);
        if (adaptive) {
          const bounds = canvas.getBoundingClientRect();
          effective = stageLayout(bounds.width, bounds.height, this.context.config);
          if (!effective.supported) { effective = layout; stopReason = 'layout_changed'; }
        }
        meta.device = { viewportWidth: innerWidth, viewportHeight: innerHeight, stageScale: effective.scale, touchCapable: navigator.maxTouchPoints > 0,
          ...(adaptive ? { stageWidthCss: effective.width, stageHeightCss: effective.height } : {}) };
      }
      // The measured 120 seconds begin after 0, never during authorization or the countdown.
      meta.startedAtMs = performance.now();
      this.engine = registry[this.context.taskId].create(resolveConfig(this.context.config, effective.width, effective.height), meta);
      await this.journal.create(this.engine.snapshot());
      if (stopReason || document.hidden || innerWidth !== meta.device.viewportWidth || innerHeight !== meta.device.viewportHeight) {
        this.engine.finish(stopReason ?? (document.hidden ? 'visibility_lost' : 'layout_changed'), this.engine.at);
        await this.closeExecution(); return;
      }
      this.runStage(canvas!);
      this.say('Actividad iniciada. Toca las estrellas y deja pasar las lunas.');
    } catch (error) {
      this.problem = error instanceof ApiError && [401, 403, 409].includes(error.status)
        ? 'Necesitamos ayuda de tu profesor para autorizar esta actividad.'
        : 'No se confirmó el inicio. Comprobaremos el mismo intento; no vuelvas a abrir otra actividad.';
      this.context = undefined;
      this.render();
    } finally { this.starting = false; if (!this.engine?.running) clearInterval(this.leaseTimer); this.refreshAvailability(); }
  }
  private async countIn(): Promise<TerminationReason | null> {
    const abort = this.countdownAbort = new AbortController();
    this.countdownStopReason = null;
    const hide = () => { if (document.hidden) { this.countdownStopReason = 'visibility_lost'; abort.abort(); } };
    const leave = () => { this.countdownStopReason = 'visibility_lost'; abort.abort(); };
    document.addEventListener('visibilitychange', hide); window.addEventListener('pagehide', leave);
    this.main.querySelectorAll('button').forEach(control => { control.disabled = true; });
    this.startButton?.classList.add('countdown');
    try {
      if (document.hidden) hide();
      await countdown(value => {
        this.countdownValue = value;
        if (this.startButton) { this.startButton.textContent = String(value); this.startButton.setAttribute('aria-label', `Comenzamos en ${value}`); }
        this.refreshAvailability(); this.say(value ? `Comenzamos en ${value}` : 'Comenzamos');
      }, abort.signal);
      return null;
    } catch { return this.countdownStopReason ?? 'user_exit'; }
    finally {
      this.countdownValue = null; this.countdownAbort = undefined;
      document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', leave);
    }
  }
  private mountStage(layout: ReturnType<typeof stageLayout>): HTMLCanvasElement {
    this.main.replaceChildren(); this.main.classList.add('main-running');
    this.startButton = undefined; this.reasonNode = undefined;
    const adaptive = isViewportConfig(this.context!.config);
    this.main.classList.toggle('viewport-running', adaptive);
    const top = el('div', 'game-top'); top.append(el('h1', '', 'Lluvia de estrellas'));
    const exitSlot = el('div', 'exit-slot');
    const exit = button('Terminar', () => {
      top.classList.add('confirming-exit');
      const question = el('span', '', '¿Terminar?');
      exitSlot.replaceChildren(question, button('Seguir', () => { top.classList.remove('confirming-exit'); exitSlot.replaceChildren(exit); }), button('Sí, terminar', () => this.interrupt('user_exit'), 'button primary'));
    }, 'button quiet'); exit.setAttribute('aria-label', 'Terminar actividad'); exitSlot.append(exit); top.append(exitSlot);
    const wrap = el('div', 'stage-wrap'); const canvas = el('canvas', 'stage');
    canvas.style.visibility = 'hidden';
    canvas.setAttribute('aria-label', 'Toca las estrellas que caen. No toques las lunas. Esta actividad requiere apuntar.');
    canvas.style.width = adaptive ? '100%' : `${layout.width}px`; canvas.style.height = adaptive ? '100%' : `${layout.height}px`;
    wrap.append(canvas); this.main.append(top, wrap);
    return canvas;
  }
  private runStage(canvas: HTMLCanvasElement): void {
    const bounds = canvas.getBoundingClientRect();
    const view = new CanvasView(canvas); view.resize(bounds.width, bounds.height);
    const abort = this.gameAbort = new AbortController();
    const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void) => window.addEventListener(type, fn, { signal: abort.signal });
    canvas.addEventListener('pointerdown', event => {
      if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
      if (!['mouse', 'touch', 'pen'].includes(event.pointerType)) return;
      event.preventDefault(); const bounds = canvas.getBoundingClientRect();
      this.engine!.pointer((event.clientX - bounds.left) * this.engine!.config.logicalWidth / bounds.width, (event.clientY - bounds.top) * this.engine!.config.logicalHeight / bounds.height,
        performance.now(), event.pointerType as 'mouse' | 'touch' | 'pen', event.isPrimary);
      this.capture();
    }, { signal: abort.signal });
    const visibility = () => { if (document.hidden) this.interrupt('visibility_lost'); };
    document.addEventListener('visibilitychange', visibility, { signal: abort.signal });
    on('pagehide', () => this.interrupt('visibility_lost'));
    on('blur', () => { this.engine?.incident('focus_lost', 'MEASUREMENT_AFFECTED', performance.now()); this.capture(); });
    on('offline', () => { this.engine?.incident('network_lost', 'CONTEXT_ONLY', performance.now()); this.capture(); });
    on('online', () => { this.engine?.incident('network_restored', 'CONTEXT_ONLY', performance.now()); this.capture(); });
    on('error', () => this.interrupt('script_error'));
    on('unhandledrejection', () => this.interrupt('script_error'));
    on('resize', () => { if (innerWidth !== this.engine!.meta.device.viewportWidth || innerHeight !== this.engine!.meta.device.viewportHeight) this.interrupt('layout_changed'); });
    const frame = (at: number) => {
      if (!this.engine) return;
      if (!this.engine.running) { void this.closeExecution(); return; }
      this.engine.frame(at); view.draw(this.engine); this.capture();
      if (this.engine.running) this.raf = requestAnimationFrame(frame);
      else void this.closeExecution();
    };
    this.raf = requestAnimationFrame(frame);
    canvas.style.visibility = 'visible';
  }
  private capture(): void {
    if (!this.engine || !this.journal) return;
    if (this.engine.revision === this.lastRevision && this.engine.at - this.lastQueuedAt < 1000) return;
    if (this.queuedWrites >= 32) { this.interrupt('storage_failure'); return; }
    this.lastRevision = this.engine.revision; this.lastQueuedAt = this.engine.at;
    const snapshot = this.engine.snapshot();
    this.queuedWrites++;
    this.queue = this.queue.then(() => this.journal!.checkpoint(snapshot)).finally(() => this.queuedWrites--);
    // A rejected commit stops measurement, not just the network or the presentation of an error.
    void this.queue.catch(() => { if (this.engine?.running) this.interrupt('storage_failure'); });
  }
  private interrupt(reason: TerminationReason): void {
    if (!this.engine?.running) return;
    this.engine.finish(reason, Math.max(this.engine.at, Math.min(performance.now(), this.engine.at + 250)));
    void this.closeExecution();
  }
  private async closeExecution(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    cancelAnimationFrame(this.raf); this.gameAbort?.abort(); clearInterval(this.leaseTimer);
    this.main.classList.remove('main-running', 'viewport-running');
    this.screen = 'finish'; this.status = 'Conservando lo que se pudo registrar…'; this.render(true);
    try {
      await this.queue.catch(() => undefined);
      this.lastOut = await this.journal!.finalize(this.engine!.snapshot());
      this.bridge?.notify('EXECUTION_FINISHED', this.lastOut.sessionId, this.lastOut.envelope.submissionId);
      this.bridge?.notify('DELIVERY_PENDING', this.lastOut.sessionId, this.lastOut.envelope.submissionId);
      this.status = ''; this.render();
      if (navigator.onLine) this.updateDelivery(await this.delivery!.send(this.lastOut.sessionId, true));
    } catch {
      this.memoryOnly = true; this.status = '';
      this.say('El almacenamiento falló. No podemos confirmar un respaldo completo en este navegador.'); this.render();
    } finally {
      if (this.context) await this.db?.release(`execution:${this.context.sessionId}`, this.owner).catch(() => undefined);
      this.closing = false;
    }
  }
  private updateDelivery(state: DeliveryState): void {
    if (state === 'BUSY') return;
    const changed = this.deliveryState !== state;
    this.deliveryState = state;
    if (state === 'SAVED' && this.lastOut) this.bridge?.notify('RESULTS_SAVED', this.lastOut.sessionId, this.lastOut.envelope.submissionId);
    if (this.screen === 'finish' && changed) { this.render(); this.say(state === 'SAVED' ? 'Tus resultados se guardaron.' : 'El envío necesita atención.'); }
  }
  private finishScreen(): void {
    const section = el('section', 'finish-sheet');
    const interrupted = this.lastOut?.envelope.state !== 'completed';
    const mark = el('div', 'finish-mark'); mark.append(shape(this.deliveryState === 'SAVED' ? 'star' : 'moon'));
    const title = el('h1', '', interrupted ? 'La actividad se interrumpió' : 'Terminaste la actividad');
    const description = el('p', 'intro-copy', interrupted ? 'No pasa nada. Puedes avisar a tu profesor.' : 'Gracias por participar. Ya puedes descansar.');
    section.append(mark, title, description);
    let heading: string; let text: string;
    if (this.memoryOnly) {
      heading = 'No podemos confirmar un respaldo completo'; text = 'El almacenamiento falló. Puede quedar un registro parcial anterior. No cierres esta página y pide ayuda a tu profesor; no podemos prometer recuperar los últimos eventos.';
    } else if (this.deliveryState === 'SAVED') {
      heading = 'Tus resultados se guardaron'; text = 'El servidor confirmó que recibió el registro. Puedes cerrar esta página.';
    } else if (this.deliveryState === 'AUTH_REQUIRED' || this.deliveryState === 'BLOCKED') {
      heading = 'Necesitamos ayuda de tu profesor para enviar los resultados'; text = 'El registro sigue pendiente en este navegador. No borres los datos del sitio ni empieces otra actividad para intentar enviarlo.';
    } else {
      heading = this.status || 'Falta enviar tus resultados';
      text = this.lastOut ? 'Hay un respaldo local pendiente. Reintentaremos mientras esta página esté abierta y tenga conexión. Si la cierras, vuelve desde la misma ruta, sitio y navegador. No borres sus datos.' : 'Estamos cerrando el registro de la actividad. Todavía no hay confirmación del servidor.';
    }
    const delivery = el('div', 'delivery-note'); delivery.append(el('h2', '', heading), el('p', '', text));
    if (this.lastOut && !this.memoryOnly && this.deliveryState === 'PENDING') delivery.append(button('Reintentar envío', () => { void this.maintain(true); }));
    section.append(delivery); this.main.append(section);
    if (this.publicEntry) this.main.append(this.publicLink('/pendientes', 'Enviar una actividad pendiente'), this.publicLink('/', 'Ingresar otro código'));
  }
  private help(): void {
    // Never place a modal over a measured stimulus. Help is available only outside execution.
    if (this.starting || this.engine?.running) { this.say('La actividad está por comenzar o ya está en marcha.'); return; }
    const dialog = el('dialog', 'help-dialog'); dialog.setAttribute('aria-labelledby', 'help-title');
    const heading = el('h2', '', 'Estamos para ayudarte'); heading.id = 'help-title';
    dialog.append(heading, el('p', '', 'Toca las estrellas una sola vez y deja pasar las lunas. Puedes repetir el ejemplo antes de comenzar.'),
      el('p', '', 'Si no puedes comenzar o enviar el registro, avisa a tu profesor. No borres los datos del navegador.'),
      el('p', '', 'Esta versión requiere apuntar con ratón, dedo o lápiz; no ofrece una medición equivalente por teclado o lector de pantalla.'),
      button('Entendido', () => { dialog.close(); dialog.remove(); }, 'button primary'));
    this.root.append(dialog); dialog.addEventListener('close', () => dialog.remove(), { once: true }); dialog.showModal();
  }
  destroy(): void {
    if (this.countdownAbort) { this.countdownStopReason = 'user_exit'; this.countdownAbort.abort(); }
    if (this.engine?.running) { registry['TG-01'].destroy(this.engine); void this.closeExecution(); }
    cancelAnimationFrame(this.raf); this.gameAbort?.abort(); this.bridge?.destroy(); clearInterval(this.maintenanceTimer); clearInterval(this.leaseTimer);
  }
}
