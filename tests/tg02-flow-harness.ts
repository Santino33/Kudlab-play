import { Flow } from '../src/games/tg02/flow';
import { finalizePalabra } from '../src/games/tg02/snapshot';
import { contextSchema } from '../src/contract/palabra-intrusa';
import context from '../contract/kudlab-runtime-1.5.0/context-tg02.synthetic.json';
const flow = new Flow(document.querySelector('#game')!, s => {
  Object.assign(window, { tg02Snapshot: s });
}, s => {
  try { Object.assign(window, { tg02Result: finalizePalabra(contextSchema.parse(context), s, '60000000-0000-4000-8000-000000000002') }); }
  catch (error) { Object.assign(window, { tg02Error: String(error) }); }
});
Object.assign(window, { tg02Flow: flow });
void flow.start();
