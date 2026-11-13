import { z } from 'zod';
import { contextSchema as tg01Context, envelopeSchema as tg01Envelope } from './schema';
import { mentalistaContextSchema, mentalistaEnvelopeSchema } from './mentalista';
import { kudDiceContextSchema, kudDiceEnvelopeSchema } from './kud-dice';
export const contextSchema = z.union([tg01Context, mentalistaContextSchema, kudDiceContextSchema]);
export const envelopeSchema = z.union([tg01Envelope, mentalistaEnvelopeSchema, kudDiceEnvelopeSchema]);
export type SessionContext = z.infer<typeof contextSchema>;
export type Envelope = z.infer<typeof envelopeSchema>;
