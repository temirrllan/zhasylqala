/* Reproducible logistic regression trained on synthetic expert-rule targets.
   This is a demo estimator, not a model validated against Pavlodar planting outcomes. */
(function (root) {
  const clamp = (x, low, high) => Math.max(low, Math.min(high, x));
  const sigmoid = x => 1 / (1 + Math.exp(-x));
  const vector = x => [1, x.base - .7, x.waterGap / 3, x.soilPrep, x.saline, x.road, x.shadeMismatch];
  let seed = 20261029;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
  const sample = () => {
    const x = {
      base: .65 + random() * .18,
      waterGap: Math.floor(random() * 6) - 2,
      soilPrep: random() < .25 ? 1 : 0,
      saline: random() < .18 ? 1 : 0,
      road: random() < .45 ? 1 : 0,
      shadeMismatch: random() < .22 ? 1 : 0,
    };
    const target = clamp(x.base + .055 * x.waterGap - .07 * x.soilPrep - .12 * x.saline - .045 * x.road - .06 * x.shadeMismatch, .30, .90);
    return {x: vector(x), target};
  };
  const samples = Array.from({length: 420}, sample);
  const train = samples.slice(0, 336);
  const validation = samples.slice(336);
  const weights = [0, 0, 0, 0, 0, 0, 0];
  for (let epoch = 0; epoch < 450; epoch++) {
    const gradients = Array(weights.length).fill(0);
    for (const row of train) {
      const prediction = sigmoid(weights.reduce((sum, w, i) => sum + w * row.x[i], 0));
      for (let i = 0; i < weights.length; i++) gradients[i] += (prediction - row.target) * row.x[i];
    }
    for (let i = 0; i < weights.length; i++) weights[i] -= .65 * gradients[i] / train.length;
  }
  const predict = x => clamp(sigmoid(weights.reduce((sum, w, i) => sum + w * vector(x)[i], 0)), .30, .90);
  const syntheticMae = validation.reduce((sum, row) => sum + Math.abs(sigmoid(weights.reduce((s, w, i) => s + w * row.x[i], 0)) - row.target), 0) / validation.length;
  root.ZhasylModel = Object.freeze({predict, syntheticMae, trainingRows: train.length, validationRows: validation.length, kind: 'synthetic-logistic-regression'});
})(typeof window === 'undefined' ? globalThis : window);
