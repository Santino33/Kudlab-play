import { z } from 'zod';

export const LOADS = [1, 2, 3, 4] as const;
export const operationSchema = z.strictObject({ op: z.enum(['suma', 'resta']), n: z.number().int().min(1).max(6) }).readonly();
export const itemSchema = z.strictObject({
  id: z.string().regex(/^(P[12]|M[1-4]-[1-3])$/), load: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  start: z.number().int().min(1).max(9), ops: z.array(operationSchema).min(1).max(4).readonly(),
  intermediates: z.array(z.number().int().min(0).max(20)).max(3).readonly(), answer: z.number().int().min(0).max(20),
  options: z.array(z.number().int().min(0).max(20)).length(4).readonly(), correctIdx: z.number().int().min(0).max(3),
}).superRefine((item, ctx) => {
  const fail = () => ctx.addIssue({ code: 'custom', message: 'Invalid mathematical item' });
  if (item.ops.length !== item.load || item.intermediates.length !== item.load - 1) fail();
  let value = item.start;
  const seen = new Set([value]);
  item.ops.forEach((op, index) => {
    value += op.op === 'suma' ? op.n : -op.n;
    if (value < 0 || value > 20 || seen.has(value)) fail();
    seen.add(value);
    if (index < item.ops.length - 1 && item.intermediates[index] !== value) fail();
  });
  if (value !== item.answer || value === item.start || item.options[item.correctIdx] !== value) fail();
  if (item.load >= 2 && new Set(item.ops.map(op => op.op)).size !== 2) fail();
  if (new Set(item.options).size !== 4 || item.options.some((option, index) => index > 0 && option <= item.options[index - 1]!)) fail();
  if (item.options.some((option, index) => index !== item.correctIdx && ![1, 2, 3].includes(Math.abs(option - item.answer)))) fail();
}).readonly();
export type Item = z.infer<typeof itemSchema>;

export const bankSchema = z.strictObject({
  itemBankVersion: z.literal('1.0.0'), generatorSeed: z.literal(3031),
  practice: z.array(itemSchema).length(2).readonly(), items: z.array(itemSchema).length(12).readonly(),
}).superRefine((bank, ctx) => {
  const fail = () => ctx.addIssue({ code: 'custom', message: 'Invalid mathematical bank' });
  const all = [...bank.practice, ...bank.items];
  if (new Set(all.map(item => item.id)).size !== 14 || new Set(all.map(item => JSON.stringify([item.start, item.ops]))).size !== 14) fail();
  if (bank.practice.some((item, index) => item.id !== `P${index + 1}` || item.load !== index + 1)) fail();
  const positions = [0, 0, 0, 0];
  for (const load of LOADS) {
    const items = bank.items.filter(item => item.load === load);
    if (items.length !== 3 || new Set(items.map(item => item.correctIdx)).size !== 3 || new Set(items.map(item => item.answer)).size !== 3) fail();
    if (items.some(item => !new RegExp(`^M${load}-[1-3]$`).test(item.id))) fail();
  }
  for (const item of all) {
    if (item.options.some((value, index) => index !== item.correctIdx && all.some(other => other.answer !== item.answer && other.answer === value))) fail();
  }
  for (const item of bank.items) {
    positions[item.correctIdx] = positions[item.correctIdx]! + 1;
    if (bank.items.filter(other => other.answer === item.answer).length > 3) fail();
  }
  if (positions.some(count => count !== 3)) fail();
}).readonly();
export type Bank = z.infer<typeof bankSchema>;

function item(id: string, start: number, signedOps: number[], options: number[]) {
  let value = start;
  const values = signedOps.map(op => (value += op));
  return { id, load: signedOps.length, start, ops: signedOps.map(n => ({ op: n > 0 ? 'suma' : 'resta', n: Math.abs(n) })),
    intermediates: values.slice(0, -1), answer: value, options, correctIdx: options.indexOf(value) };
}

// Authorized source: TD-MENTALISTA@01e5433a79337882b9479f37829a660812bed9b3, items.json (bank 1.0.0).
// Functional adoption does not establish teacher validation; production publication remains gated.
export const BANK = bankSchema.parse({ itemBankVersion: '1.0.0', generatorSeed: 3031,
  practice: [item('P1', 5, [-3], [0, 1, 2, 4]), item('P2', 8, [1, -3], [3, 6, 8, 9])],
  items: [
    item('M1-1', 7, [3], [7, 8, 9, 10]), item('M1-2', 8, [-6], [0, 2, 3, 4]), item('M1-3', 9, [5], [12, 13, 14, 16]),
    item('M2-1', 1, [6, -5], [0, 2, 3, 4]), item('M2-2', 9, [6, -1], [14, 15, 16, 17]), item('M2-3', 5, [-3, 4], [3, 4, 5, 6]),
    item('M3-1', 2, [1, 6, -3], [6, 7, 8, 9]), item('M3-2', 7, [-2, -5, 2], [0, 1, 2, 4]), item('M3-3', 5, [4, 3, -2], [7, 8, 9, 10]),
    item('M4-1', 7, [-2, 5, 4, 4], [16, 17, 18, 20]), item('M4-2', 3, [2, -3, -2, 6], [6, 7, 8, 9]), item('M4-3', 6, [-3, 6, 2, 3], [12, 14, 15, 16]),
  ],
});

function random(seed: number) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function shuffle<T>(values: readonly T[], rnd: () => number): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
function maxRun(values: readonly number[]) {
  let max = 0, run = 0;
  values.forEach((value, index) => { run = index > 0 && value === values[index - 1] ? run + 1 : 1; max = Math.max(max, run); });
  return max;
}
export function buildSequence(bank: Bank = BANK, seed = 30303): { item: Item; plannedBlock: number }[] {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('INVALID_SEQUENCE_SEED');
  bank = bankSchema.parse(bank);
  const rnd = random(seed);
  for (let attempt = 0; attempt < 5000; attempt++) {
    const byLoad = new Map(LOADS.map(load => [load, shuffle(bank.items.filter(item => item.load === load), rnd)]));
    const sequence: { item: Item; plannedBlock: number }[] = [];
    for (let block = 0; block < 3; block++) for (const load of shuffle(LOADS, rnd)) sequence.push({ item: byLoad.get(load)![block]!, plannedBlock: block + 1 });
    if (maxRun(sequence.map(entry => entry.item.load)) <= 2 && maxRun(sequence.map(entry => entry.item.correctIdx)) <= 2) return sequence;
  }
  throw new Error('SEQUENCE_CONSTRAINTS_UNSATISFIED');
}
