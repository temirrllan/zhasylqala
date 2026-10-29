/* Indicative geometry only. It cannot verify soil, utilities or planting rights. */
(function (root) {
  const METRES_PER_DEGREE = 111320;
  const MAX_CANDIDATES = 100000;
  const MAX_CAPACITY = 5001;

  function inside(point, ring) {
    let contained = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > point[1]) !== (b[1] > point[1]) &&
          point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) contained = !contained;
    }
    return contained;
  }

  function edgeDistance(point, ring) {
    let closest = Infinity;
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i], b = ring[i + 1], dx = b[0] - a[0], dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      closest = Math.min(closest, Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy));
    }
    return closest;
  }

  function plan(geometry, requested, spacing) {
    if (geometry?.type !== 'Polygon' || geometry.coordinates?.length !== 1) return {points: [], capacity: 0, error: 'Нужен простой полигон участка.'};
    const source = geometry.coordinates[0];
    if (!Array.isArray(source) || source.length < 4 || !source.every(p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))) return {points: [], capacity: 0, error: 'Координаты контура некорректны.'};
    if (source[0][0] !== source[source.length - 1][0] || source[0][1] !== source[source.length - 1][1]) return {points: [], capacity: 0, error: 'Контур полигона не замкнут.'};
    const metres = Number(spacing), count = Math.floor(Number(requested));
    if (!Number.isFinite(metres) || metres < 2 || metres > 30 || !Number.isInteger(count) || count < 1 || count > 5000) return {points: [], capacity: 0, error: 'Неверное расстояние или количество.'};
    const lat0 = source.reduce((sum, p) => sum + p[1], 0) / source.length;
    const lon0 = source[0][0], latRad = lat0 * Math.PI / 180;
    const mx = METRES_PER_DEGREE * Math.cos(latRad), my = METRES_PER_DEGREE;
    if (mx <= 0) return {points: [], capacity: 0, error: 'Широта контура не поддерживается.'};
    const ring = source.map(([lon, lat]) => [(lon - lon0) * mx, (lat - lat0) * my]);
    const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const cols = Math.floor((maxX - minX) / metres) + 1, rows = Math.floor((maxY - minY) / metres) + 1;
    if (cols * rows > MAX_CANDIDATES) return {points: [], capacity: 0, error: 'Контур слишком велик для локальной схемы; разделите его на зоны.'};
    const inset = metres / 2, candidates = [];
    for (let row = 0; row < rows; row++) {
      const y = minY + inset + row * metres;
      for (let col = 0; col < cols; col++) {
        const x = minX + inset + col * metres, point = [x, y];
        if (inside(point, ring) && edgeDistance(point, ring) + .05 >= inset) {
          candidates.push([lon0 + x / mx, lat0 + y / my]);
          if (candidates.length >= MAX_CAPACITY) break;
        }
      }
      if (candidates.length >= MAX_CAPACITY) break;
    }
    const size = Math.min(count, candidates.length);
    const points = Array.from({length: size}, (_, i) => candidates[Math.floor((i + .5) * candidates.length / size)]);
    return {points, capacity: candidates.length, capped: candidates.length >= MAX_CAPACITY, spacing: metres, inset};
  }

  root.PlantingLayout = {plan};
  if (typeof module !== 'undefined' && module.exports) module.exports = {plan};
})(typeof window !== 'undefined' ? window : globalThis);
