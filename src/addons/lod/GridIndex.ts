export type AABB = { min: [number, number, number]; max: [number, number, number] };

export type GridCell = {
  indices: Uint32Array;
  repr?: Uint32Array;
  aabb: AABB;
};

export type GridIndex = {
  cells: GridCell[];
  cellSize: number;
  sceneAabb: AABB;
};

export function buildGridIndex(
  positions: Float32Array,
  options: { cellSize?: number; maxReprPerCell?: number } = {}
): GridIndex {
  const cellSize = options.cellSize ?? 1.5;
  const N = positions.length / 3;

  const aabb: AABB = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  for (let i = 0; i < N; i++) {
    const x = positions[i * 3 + 0];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    if (x < aabb.min[0]) aabb.min[0] = x;
    if (y < aabb.min[1]) aabb.min[1] = y;
    if (z < aabb.min[2]) aabb.min[2] = z;
    if (x > aabb.max[0]) aabb.max[0] = x;
    if (y > aabb.max[1]) aabb.max[1] = y;
    if (z > aabb.max[2]) aabb.max[2] = z;
  }

  const map = new Map<string, number[]>();
  const keyOf = (x: number, y: number, z: number) =>
    `${Math.floor((x - aabb.min[0]) / cellSize)}|${Math.floor((y - aabb.min[1]) / cellSize)}|${Math.floor(
      (z - aabb.min[2]) / cellSize
    )}`;

  for (let i = 0; i < N; i++) {
    const x = positions[i * 3 + 0];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const k = keyOf(x, y, z);
    const arr = map.get(k);
    if (arr) arr.push(i);
    else map.set(k, [i]);
  }

  const cells: GridCell[] = [];
  const toWorldAabb = (key: string): AABB => {
    const [gx, gy, gz] = key.split('|').map((v) => parseInt(v, 10));
    const minX = aabb.min[0] + gx * cellSize;
    const minY = aabb.min[1] + gy * cellSize;
    const minZ = aabb.min[2] + gz * cellSize;
    return { min: [minX, minY, minZ], max: [minX + cellSize, minY + cellSize, minZ + cellSize] };
  };

  const maxRepr = options.maxReprPerCell ?? 32;
  for (const [k, arr] of map) {
    const idx = Uint32Array.from(arr);
    let repr: Uint32Array | undefined;
    if (idx.length > maxRepr) {
      const step = Math.max(1, Math.floor(idx.length / maxRepr));
      const tmp: number[] = [];
      for (let i = 0; i < idx.length && tmp.length < maxRepr; i += step) tmp.push(idx[i]);
      repr = Uint32Array.from(tmp);
    }
    cells.push({ indices: idx, repr, aabb: toWorldAabb(k) });
  }

  return { cells, cellSize, sceneAabb: aabb };
}
