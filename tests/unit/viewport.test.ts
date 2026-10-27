import { expect, it } from 'vitest';
import { viewportGeometry } from '../../src/contract/layout';
import { configSchema, contextSchema, envelopeSchema, VIEWPORT_PROFILE, VIEWPORT_BUILD_ID } from '../../src/contract/schema';
import { Engine, resolveConfig, stageLayout } from '../../src/games/tg01/engine';
import { contextFixture, envelopeFixture } from '../fixtures/context';

it.each([[320, 568], [390, 772], [844, 318], [1440, 828]])('llena %s×%s sin deformar ni reducir blancos por debajo de 45 px', (width, height) => {
  const layout = stageLayout(width, height, VIEWPORT_PROFILE);
  expect(layout.supported).toBe(true); expect(layout.width).toBe(width); expect(layout.height).toBe(height);
  expect(75 * layout.scale).toBeGreaterThanOrEqual(45);
  const config = resolveConfig(VIEWPORT_PROFILE, width, height);
  expect(config.logicalWidth * layout.scale).toBeCloseTo(width);
  expect(config.logicalHeight * layout.scale).toBeCloseTo(height);
  expect(config.logicalWidth / config.lanes).toBeGreaterThanOrEqual(105);
});
it('versiona el perfil adaptable sin aceptar condiciones nuevas como contrato 1.0', () => {
  expect(configSchema.safeParse(VIEWPORT_PROFILE).success).toBe(true);
  const context = contextFixture(); context.config = VIEWPORT_PROFILE;
  expect(contextSchema.safeParse(context).success).toBe(false);
  context.contractVersion = '1.1'; context.gameBuildId = VIEWPORT_BUILD_ID;
  expect(contextSchema.safeParse(context).success).toBe(true);
});
it('registra y valida la geometría efectiva del dispositivo; el contrato anterior sigue legible', () => {
  const e = envelopeFixture();
  expect(envelopeSchema.safeParse(e).success).toBe(true);
  const geometry = viewportGeometry(390, 772);
  e.contractVersion = '1.1'; e.gameBuildId = VIEWPORT_BUILD_ID;
  e.device = { viewportWidth: 390, viewportHeight: 844, stageScale: geometry.scale, touchCapable: true, stageWidthCss: 390, stageHeightCss: 772 };
  e.events[0].geometry.x = (2 - .5) * geometry.logicalWidth / geometry.lanes;
  expect(envelopeSchema.safeParse(e).success).toBe(true);
  e.events[0].geometry.x += 1;
  expect(envelopeSchema.safeParse(e).success).toBe(false);
});
it('el motor usa altura/carriles efectivos y conserva 120 segundos', () => {
  const base = envelopeFixture(); const config = resolveConfig(VIEWPORT_PROFILE, 390, 772);
  const engine = new Engine(config, { clock: base.clock, device: base.device, startedAtMs: 1000 }, () => 0);
  engine.frame(1000);
  for (let at = 1010; at <= 121000; at += 10) engine.frame(at);
  expect(engine.snapshot().terminationReason).toBe('time_limit');
  expect(engine.snapshot().checkpointAtMs).toBe(121000);
  expect(engine.snapshot().events[0].geometry.x).toBe(config.logicalWidth / config.lanes / 2);
});
