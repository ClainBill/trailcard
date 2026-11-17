// FSRS-4.5 scheduler with the published default weights.
// Grades: 1 Again, 2 Hard, 3 Good, 4 Easy.

const W = [
  0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072,
  0.0793, 0.3246, 1.587, 0.2272, 2.8755,
];
const DECAY = -0.5;
const FACTOR = 19 / 81;
export const DAY = 86_400_000;
export const RELEARN_DELAY = 10 * 60_000;

const clampD = (d) => Math.min(10, Math.max(1, d));
const initDifficulty = (grade) => clampD(W[4] - (grade - 3) * W[5]);

export function newSrs(now = Date.now()) {
  return { state: 'new', due: now, stability: 0, difficulty: 0, reps: 0, lapses: 0, last: 0 };
}

export function retrievability(srs, now = Date.now()) {
  if (srs.state === 'new' || !srs.stability) return 0;
  const days = Math.max(0, (now - srs.last) / DAY);
  return Math.pow(1 + (FACTOR * days) / srs.stability, DECAY);
}

export function schedule(srs, grade, now = Date.now(), retention = 0.9) {
  let S;
  let D;
  if (srs.state === 'new' || !srs.stability) {
    S = W[grade - 1];
    D = initDifficulty(grade);
  } else {
    const R = retrievability(srs, now);
    S = srs.stability;
    D = srs.difficulty;
    if (grade === 1) {
      const forgot = W[11] * Math.pow(D, -W[12]) * (Math.pow(S + 1, W[13]) - 1) * Math.exp((1 - R) * W[14]);
      S = Math.min(S, forgot);
    } else {
      const growth =
        Math.exp(W[8]) *
        (11 - D) *
        Math.pow(S, -W[9]) *
        (Math.exp((1 - R) * W[10]) - 1) *
        (grade === 2 ? W[15] : 1) *
        (grade === 4 ? W[16] : 1);
      S = S * (1 + growth);
    }
    D = clampD(W[7] * initDifficulty(3) + (1 - W[7]) * (D - W[6] * (grade - 3)));
  }
  S = Math.max(0.1, S);

  // Again comes back within the same session; everything else waits whole days.
  const days = Math.max(1, Math.round((S / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1)));
  const due = grade === 1 ? now + RELEARN_DELAY : now + days * DAY;

  return {
    state: 'review',
    due,
    stability: S,
    difficulty: D,
    reps: srs.reps + 1,
    lapses: srs.lapses + (grade === 1 && srs.state !== 'new' ? 1 : 0),
    last: now,
  };
}

// Interval each button would give, for the labels under the grade buttons.
export function previewIntervals(srs, now = Date.now(), retention = 0.9) {
  return [1, 2, 3, 4].map((g) => schedule(srs, g, now, retention).due - now);
}

export function formatInterval(ms) {
  const min = ms / 60_000;
  if (min < 60) return `${Math.max(1, Math.round(min))}m`;
  const hours = min / 60;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${(days / 30).toFixed(1).replace(/\.0$/, '')}mo`;
  return `${(days / 365).toFixed(1).replace(/\.0$/, '')}y`;
}
