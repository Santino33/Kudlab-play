import { z } from 'zod';
import { contextSchema as tg01Context, envelopeSchema as tg01Envelope } from './schema';
import { mentalistaContextSchema, mentalistaEnvelopeSchema } from './mentalista';
export const contextSchema = z.union([tg01Context, mentalistaContextSchema]);
export const envelopeSchema = z.union([tg01Envelope, mentalistaEnvelopeSchema]);
export type SessionContext = z.infer<typeof contextSchema>;
export type Envelope = z.infer<typeof envelopeSchema>;
