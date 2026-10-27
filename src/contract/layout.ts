// Explicit 1.1 policy. Actual dimensions are frozen and recorded when the measurement starts.
export const VIEWPORT_POLICY = Object.freeze({ referenceWidthUnits: 480, minimumLaneWidthUnits: 120, maximumLanes: 6 });
export function viewportGeometry(width: number, height: number) {
  const scale = Math.min(1, width / VIEWPORT_POLICY.referenceWidthUnits);
  const logicalWidth = scale > 0 ? width / scale : 0;
  const logicalHeight = scale > 0 ? height / scale : 0;
  const lanes = Math.max(1, Math.min(VIEWPORT_POLICY.maximumLanes, Math.floor(logicalWidth / VIEWPORT_POLICY.minimumLaneWidthUnits)));
  return { width, height, scale, logicalWidth, logicalHeight, lanes, supported: width >= 288 && height >= 240 };
}
