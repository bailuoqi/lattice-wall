/** Timings match the native cover animations in 20-poster.css. */
export type CoverMotion = { kind: 'enter' | 'fade'; startedAt: number; delayMs: number };

export function coverEase(progress: number, x1 = .2, y1 = .8, x2 = .2, y2 = 1): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  const curve = (t: number, a: number, b: number) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
  let low = 0, high = 1;
  for (let i = 0; i < 16; i++) {
    const middle = (low + high) / 2;
    if (curve(middle, x1, x2) < progress) low = middle;
    else high = middle;
  }
  return curve((low + high) / 2, y1, y2);
}

export function sampleCoverMotion(motion: CoverMotion | null, nowMs: number, reducedMotion: boolean) {
  if (!motion || reducedMotion) return { opacity: 1, offsetY: 0, running: false };
  const duration = motion.kind === 'enter' ? 450 : 120;
  const progress = Math.min(1, Math.max(0, (nowMs - motion.startedAt - motion.delayMs) / duration));
  const eased = motion.kind === 'enter' ? coverEase(progress) : coverEase(progress, 0, 0, .58, 1);
  return { opacity: eased, offsetY: motion.kind === 'enter' ? 18 * (1 - eased) : 0, running: progress < 1 };
}
