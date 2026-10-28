export function normalizeCode(value: string): string {
  if (value.length > 64 || !/^[A-Za-z2-9 -]+$/.test(value)) throw new Error('INVALID_CODE');
  const code = value.replace(/[ -]/g, '').toUpperCase();
  if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/.test(code)) throw new Error('INVALID_CODE');
  return code;
}
