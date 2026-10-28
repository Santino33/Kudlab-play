import '../../src/styles.css';
const host = document.querySelector<HTMLElement>('#host')!;
const runtimeOrigin = import.meta.env.VITE_API_ORIGIN;
const clean = location.pathname === '/demo.html';
host.className = clean ? 'demo-clean' : 'simulator-shell';
const bar = document.createElement('div'); bar.className = 'simulator-bar';
const title = document.createElement('strong'); title.textContent = 'Laboratorio J-01 · Solo datos sintéticos';
const button = document.createElement('button'); button.textContent = 'Crear sesión sintética';
const tools = document.createElement('details'); tools.className = 'simulator-tools';
const summary = document.createElement('summary'); summary.textContent = 'Herramientas de desarrollo';
const explanation = document.createElement('p'); explanation.textContent = 'Estas opciones solo prueban errores técnicos. No cambian la dificultad ni forman parte del juego para niños.';
const label = document.createElement('label'); label.textContent = 'Simular condición técnica: ';
const select = document.createElement('select');
const hint = document.createElement('p'); hint.setAttribute('role', 'status');
const descriptions: Record<string, string> = {
  normal: 'Normal: el servidor de prueba recibe el registro y confirma que lo guardó.',
  lost_ack: 'El servidor guarda el registro, pero se pierde su confirmación. La aplicación debe reenviar el mismo registro sin duplicarlo.',
  lost_claim: 'Se pierde la confirmación de autorización. La aplicación debe recuperar la misma preparación.',
  lost_start: 'Se pierde la respuesta que confirma el inicio. No debe empezar a medir sin saber qué ocurrió.',
  network: 'El juego continúa, pero el registro queda pendiente porque no puede enviarse.',
  '401': 'La autorización de envío ya no sirve. Debe conservarse el registro y pedir ayuda al profesor.',
  '403': 'El servidor rechaza la participación. No debe borrarse ni enviarse con la autorización de otra persona.',
  '409': 'El servidor detecta un conflicto. El registro se conserva para revisión, sin inventar otro envío.',
  '429': 'Hay demasiadas solicitudes. La aplicación debe esperar antes de volver a intentar.',
  '503': 'El servidor está temporalmente fuera de servicio. Se conserva el registro y se reintenta después.',
  delay: 'El servidor tarda un segundo en responder. Sirve para comprobar el estado de espera.',
};
for (const [value, text] of [['normal', 'Normal'], ['lost_ack', 'Acuse perdido tras commit'], ['lost_claim', 'Canje perdido'], ['lost_start', 'Inicio perdido'], ['network', 'Sin red de entrega'], ['401', 'Credencial vencida'], ['403', 'Participación bloqueada'], ['409', 'Conflicto'], ['429', 'Límite de solicitudes'], ['503', 'Servicio no disponible'], ['delay', 'Respuesta lenta']]) {
  const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option);
}
hint.textContent = descriptions.normal;
label.append(select); tools.append(summary, explanation, label, hint); bar.append(title, button, tools);
if (!clean) host.append(bar);
let frame: HTMLIFrameElement | undefined;
let bridgeId = ''; let grant = ''; let modeReady: Promise<unknown> = Promise.resolve();
select.onchange = () => { hint.textContent = descriptions[select.value]; modeReady = fetch('/__simulator/mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: select.value }) }); };
const launch = async () => {
  await modeReady;
  const response = await fetch('/__simulator/launch', { method: 'POST', cache: 'no-store' });
  grant = (await response.json()).launchGrant;
  bridgeId = crypto.randomUUID(); frame?.remove();
  frame = document.createElement('iframe'); frame.title = 'Actividad infantil'; frame.className = 'runtime-frame';
  frame.src = `${runtimeOrigin}/?bridgeId=${bridgeId}`; host.append(frame);
};
button.onclick = () => { void launch(); };
window.addEventListener('message', event => {
  if (event.origin !== runtimeOrigin || event.source !== frame?.contentWindow || event.data.bridgeId !== bridgeId) return;
  if (event.data.type === 'RUNTIME_READY') frame?.contentWindow?.postMessage({ type: 'LAUNCH_AUTHORIZATION', bridgeId, launchGrant: grant }, runtimeOrigin);
});
if (clean) {
  modeReady = fetch('/__simulator/mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'normal' }) });
  void launch();
}
