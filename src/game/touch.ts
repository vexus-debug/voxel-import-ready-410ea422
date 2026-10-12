// Shared touch-control state for mobile play (written by TouchControls, read by Player).
export const touch = {
  enabled: false,
  moveX: 0, // -1..1 strafe
  moveY: 0, // -1..1 forward
  lookDX: 0, // accumulated pixels since last frame
  lookDY: 0,
  jump: false,
  sprint: false,
  primaryDown: () => {},
  primaryUp: () => {},
  place: () => {},
};

export function isTouchDevice() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(pointer: coarse)").matches || "ontouchstart" in window;
}
