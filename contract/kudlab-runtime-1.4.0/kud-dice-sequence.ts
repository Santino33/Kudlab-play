// Reference: TD-KUD-DICE e213cda8dad707d82188ba1f5d3cf1172a063f31, game.js §§2,4,5.
export const CONFIG = {
  startLength: 2, maxLength: 7, trialsPerLength: 2, reservePerLength: 1,
  stimOnMs: 600, stimOffMs: 300, preSequenceMs: 900, responseTimeoutMs: 8000,
  seed: 20263, minRtForStats: 3, practice: { length: 2, maxRounds: 2 },
} as const;

export function buildSequences() {
  let seed: number = CONFIG.seed;
  const random = () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  const make = (length: number) => {
    const sequence: number[] = [];
    for (let i = 0; i < length; i++) {
      let drum: number;
      do { drum = Math.floor(random() * 4); } while (drum === sequence.at(-1));
      sequence.push(drum);
    }
    return sequence;
  };
  const byLength: Record<number, number[][]> = {};
  for (let length = CONFIG.startLength; length <= CONFIG.maxLength; length++) {
    const sequences: number[][] = [];
    while (sequences.length < CONFIG.trialsPerLength + CONFIG.reservePerLength) {
      const sequence = make(length);
      if (!sequences.some(existing => existing.join() === sequence.join())) sequences.push(sequence);
    }
    byLength[length] = sequences;
  }
  return { byLength, practice: [make(2), make(2), make(2)] };
}

export function scoreTrial(sequence: readonly number[], responses: readonly { drum: number }[]) {
  const positions = sequence.map((target, index) => {
    const drum = responses[index]?.drum;
    if (drum === undefined) return 'omission';
    if (drum === target) return 'correct';
    if (index > 0 && drum === responses[index - 1]?.drum) return 'repetition';
    if (!sequence.includes(drum)) return 'intrusion';
    return 'order';
  });
  const count = (kind: typeof positions[number]) => positions.filter(value => value === kind).length;
  const firstError = positions.findIndex(value => value !== 'correct');
  return { positions, positionsCorrect: count('correct'), orderErrors: count('order'), intrusions: count('intrusion'),
    repetitions: count('repetition'), omissions: count('omission'), firstErrorPosition: firstError < 0 ? null : firstError + 1,
    correctPrefix: firstError < 0 ? sequence.length : firstError,
    outcome: firstError < 0 ? 'correct' as const : count('omission') ? 'incomplete' as const : 'incorrect' as const };
}
