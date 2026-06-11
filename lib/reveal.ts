const REVEAL_STAGGER_MS = 70;

export function getRevealDelayStyle(index: number) {
  return {
    transitionDelay: `${Math.max(0, index) * REVEAL_STAGGER_MS}ms`,
  };
}
