/** Krumhansl-Schmuckler key profiles: how strongly each pitch class is expected in a major / minor key. */
const PROFILES = {
  major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
  minor: [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
};

function correlation(a, b) {
  const n = a.length;
  const meanA = a.reduce((x, y) => x + y, 0) / n;
  const meanB = b.reduce((x, y) => x + y, 0) / n;
  let numerator = 0, varA = 0, varB = 0;
  for (let i = 0; i < n; i++) {
    numerator += (a[i] - meanA) * (b[i] - meanB);
    varA += (a[i] - meanA) ** 2;
    varB += (b[i] - meanB) ** 2;
  }
  return varA && varB ? numerator / Math.sqrt(varA * varB) : 0;
}

/** How well a chroma vector matches one specific key (correlation, -1..1). */
export function scoreKey(chroma, root, scale) {
  const profile = PROFILES[scale];
  return correlation(chroma, chroma.map((_, pc) => profile[(pc - root + 12) % 12]));
}

/** Best-matching major/minor key for a chroma vector. @returns {{root:number, scale:"major"|"minor", score:number}} */
export function estimateKey(chroma) {
  const candidates = [];
  for (let root = 0; root < 12; root++) {
    for (const scale of ["major", "minor"]) candidates.push({ root, scale, score: scoreKey(chroma, root, scale) });
  }
  return candidates.reduce((best, c) => (c.score > best.score ? c : best), { root: 0, scale: "major", score: -2 });
}
