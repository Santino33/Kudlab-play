export function countdown(tick: (value: number) => void, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let value = 3;
    let timer: ReturnType<typeof setTimeout>;
    const cancel = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(new Error('COUNTDOWN_CANCELLED')); };
    if (signal.aborted) { reject(new Error('COUNTDOWN_CANCELLED')); return; }
    const advance = () => {
      tick(value);
      if (value === 0) { signal.removeEventListener('abort', cancel); resolve(); }
      else { value--; timer = setTimeout(advance, 1000); }
    };
    signal.addEventListener('abort', cancel, { once: true });
    advance();
  });
}
