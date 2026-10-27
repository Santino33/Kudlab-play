import { BUILD_ID, VIEWPORT_BUILD_ID, contextSchema, type SessionContext } from '../contract/schema';
import { Engine } from './tg01/engine';
function create(...args: ConstructorParameters<typeof Engine>): Engine {
  const config = structuredClone(args[0]);
  Object.freeze(config.segmentBoundariesMs); Object.freeze(config.spawnIntervalMs); Object.freeze(config.stimulusSizeUnits);
  return new Engine(Object.freeze(config), args[1], args[2]);
}
export const registry = Object.freeze({
  'TG-01': Object.freeze({ taskId: 'TG-01', buildIds: [BUILD_ID, VIEWPORT_BUILD_ID], contractVersions: ['1.0', '1.1'],
    requiredResources: ['canvas2d', 'local-font'] as const,
    create,
    destroy: (game: Engine) => game.finish('user_exit', game.at) }),
});
export function supported(context: SessionContext): boolean {
  return contextSchema.safeParse(context).success;
}
