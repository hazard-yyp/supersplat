import type { GridCell, GridIndex } from "./GridIndex";

export type CameraPose = {
  position: [number, number, number];
  yaw?: number;
  fx?: number;
};

export type LodParams = {
  nearDist: number;
  midDist: number;
  maxPerCellNear: number;
  maxPerCellMid: number;
  screenPxThreshold: number;
};

export class LodManager {
  constructor(private grid: GridIndex, private params: LodParams) {}

  filter(cellsInView: GridCell[], cam: CameraPose, estimatePx: (gaussianIndex: number) => number): Uint32Array {
    const chosen: number[] = [];
    for (const cell of cellsInView) {
      const d = this.distanceToCell(cam.position, cell.aabb);
      const bucket = d < this.params.nearDist ? "near" : d < this.params.midDist ? "mid" : "far";

      if (bucket === "far") {
        if (cell.repr?.length) chosen.push(...cell.repr);
        continue;
      }

      const survivors: number[] = [];
      for (const gi of cell.indices) {
        const px = estimatePx(gi);
        if (px >= this.params.screenPxThreshold) survivors.push(gi);
      }
      const limit = bucket === "near" ? this.params.maxPerCellNear : this.params.maxPerCellMid;
      if (survivors.length > limit) survivors.length = limit;
      chosen.push(...survivors);
    }
    return Uint32Array.from(chosen);
  }

  private distanceToCell(pos: [number, number, number], aabb: { min: [number, number, number]; max: [number, number, number] }) {
    const dx = pos[0] < aabb.min[0] ? aabb.min[0] - pos[0] : pos[0] > aabb.max[0] ? pos[0] - aabb.max[0] : 0;
    const dy = pos[1] < aabb.min[1] ? aabb.min[1] - pos[1] : pos[1] > aabb.max[1] ? pos[1] - aabb.max[1] : 0;
    const dz = pos[2] < aabb.min[2] ? aabb.min[2] - pos[2] : pos[2] > aabb.max[2] ? pos[2] - aabb.max[2] : 0;
    return Math.hypot(dx, dy, dz);
  }
}
