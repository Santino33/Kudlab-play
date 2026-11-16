import bank from './items.json' with { type: 'json' };

// TD-PALABRA-INTRUSA@5ce3bdc, game.js §4. Preserve RNG calls and their order.
export const CONFIG = Object.freeze({
  taskId: 'TG-02', profile: 'TG02_PALABRA_INTRUSA_V1', seed: 20262,
  itemTimeoutMs: 20000, anticipatoryMs: 400, segmentCount: 3, itemsPerSegment: 6,
  itemsPerLevelPerSegment: 2, maxRun: 2, minRtOverall: 5, minRtGroup: 3,
  selectionHoldMs: 250, transitionMs: 500, practiceMaxRounds: 2,
} as const);
export const REFERENCE_COMMIT = '5ce3bdcca0e2e1bb629b390ea3b6ec681cc23b69';
export type Item = typeof bank.items[number];
export type ArrangedItem = { item: Item; words: string[]; targetIdx: number; targetWord: string };

function mulberry32(a: number) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function shuffle<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
function maxRun(values: readonly number[]) {
  let maximum = 0, run = 0;
  values.forEach((value, i) => { run = i && value === values[i - 1] ? run + 1 : 1; maximum = Math.max(maximum, run); });
  return maximum;
}
function arrange(item: Item, position: number, random: () => number): ArrangedItem {
  const targetWord = item.words[item.targetIdx]!;
  const others = shuffle(item.words.filter((_, i) => i !== item.targetIdx), random);
  let next = 0;
  const words = Array.from({ length: 4 }, (_, i) => i === position ? targetWord : others[next++]!);
  return { item: structuredClone(item), words, targetIdx: position, targetWord };
}

// Fixed published profile: no URL/teacher/test overrides in production.
export function buildSequence() {
  const random = mulberry32(CONFIG.seed);
  const levels = [1, 2, 3];
  const byLevel = levels.map(level => shuffle(bank.items.filter(item => item.level === level), random));
  let order: { item: Item; segment: number }[], positions: number[], guard = 0;
  do {
    order = [];
    for (let s = 0; s < CONFIG.segmentCount; s++) {
      const segment = byLevel.flatMap(items => items.slice(s * CONFIG.itemsPerLevelPerSegment, (s + 1) * CONFIG.itemsPerLevelPerSegment));
      order.push(...shuffle(segment, random).map(item => ({ item, segment: s + 1 })));
    }
  } while (maxRun(order.map(row => row.item.level)) > CONFIG.maxRun && ++guard < 5000);
  const n = CONFIG.segmentCount * CONFIG.itemsPerSegment;
  const extra = shuffle([0, 1, 2, 3], random).slice(0, n - 16);
  const pool = [0, 1, 2, 3].flatMap(position => Array<number>(4 + (extra.includes(position) ? 1 : 0)).fill(position));
  guard = 0;
  do { positions = shuffle(pool, random); } while (maxRun(positions) > CONFIG.maxRun && ++guard < 5000);
  const seq = order.map((row, i) => ({ ...arrange(row.item, positions[i]!, random), plannedSegment: row.segment }));
  const practicePositions = shuffle([0, 1, 2, 3], random);
  const practice = bank.practice.map((item, i) => arrange(item, practicePositions[i]!, random));
  return { seq, practice };
}

export function originalSequenceHash(seq: ReturnType<typeof buildSequence>['seq']) {
  const text = JSON.stringify(seq.map(row => [row.item.id, row.words]));
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16);
}
