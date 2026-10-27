import { z } from 'zod';
import { secretSchema, uuidV4 } from '../contract/schema';
const launchSchema = z.strictObject({ type: z.literal('LAUNCH_AUTHORIZATION'), bridgeId: uuidV4, launchGrant: secretSchema });
export function acceptsAuthorization(event: { origin: string; source: unknown; data: unknown }, origin: string, source: unknown, bridgeId: string): boolean {
  const result = launchSchema.safeParse(event.data);
  return origin !== '*' && source !== null && event.source === source && event.origin === origin && result.success && result.data.bridgeId === bridgeId;
}
export class SupervisedBridge {
  private listener?: (event: MessageEvent) => void;
  constructor(readonly origin: string, readonly bridgeId: string) { uuidV4.parse(bridgeId); }
  connect(launch: (grant: string) => void): void {
    if (window.parent === window) return;
    this.listener = event => {
      if (acceptsAuthorization(event, this.origin, window.parent, this.bridgeId)) launch(launchSchema.parse(event.data).launchGrant);
    };
    window.addEventListener('message', this.listener);
    window.parent.postMessage({ type: 'RUNTIME_READY', bridgeId: this.bridgeId }, this.origin);
  }
  notify(type: 'EXECUTION_FINISHED' | 'DELIVERY_PENDING' | 'RESULTS_SAVED' | 'RECOVERY_REQUESTED', sessionId: string, submissionId: string): void {
    if (window.parent !== window) window.parent.postMessage({ type, bridgeId: this.bridgeId, sessionId, submissionId }, this.origin);
  }
  recoveryUnavailable(sessionId: string): void {
    if (window.parent !== window) window.parent.postMessage({ type: 'RECOVERY_UNAVAILABLE', bridgeId: this.bridgeId, sessionId }, this.origin);
  }
  destroy(): void { if (this.listener) window.removeEventListener('message', this.listener); }
}
