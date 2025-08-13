// src/addons/index.ts
import { buildGridIndex } from "./lod/GridIndex";
import { LodManager, type LodParams } from "./lod/LodManager";
import { MinimapOverlay } from "./minimap/MinimapOverlay";

/**
 * 这个 setup 需要你传入一个 app 接口，最少包含：
 *  - getCameraPose(): { position:[x,y,z], yaw?:number, fx?:number }
 *  - getPositions(): Float32Array  // xyzxyz...
 *  - setDrawIndices(indices: Uint32Array): void
 *  - flyTo({x,y,z}, ms?:number): void
 * （可选）
 *  - estimatePx(i: number): number   // 若提供，将优先用于 LOD 像素估计
 */
export function setup(app: any) {
  console.log("[addons] setup() called");

  // 1) 取点位数据
  const positions: Float32Array = app.getPositions?.() ?? new Float32Array();
  if (!positions.length) {
    console.warn("[addons] positions empty; call setup AFTER .ply is loaded");
    return;
  }

  // 2) 建网格索引
  const grid = buildGridIndex(positions, { cellSize: 1.5, maxReprPerCell: 32 });

  // 3) LOD 管理器参数（可按需调）
  const params: LodParams = {
    nearDist: 12,
    midDist: 40,
    maxPerCellNear: 512,
    maxPerCellMid: 128,
    screenPxThreshold: 1.2,
  };
  const lod = new LodManager(grid, params);

  // 4) 小地图
    const bounds = {
    minX: grid.sceneAabb.min[0], maxX: grid.sceneAabb.max[0],
    minY: grid.sceneAabb.min[1], maxY: grid.sceneAabb.max[1],
    minZ: grid.sceneAabb.min[2], maxZ: grid.sceneAabb.max[2],
    };
    const minimap = new MinimapOverlay(bounds, (x, second /* y */) => {
    const cam = app.getCameraPose();
    app.flyTo({ x, y: second, z: cam.position[2] }, 900);
    }, 'XY');

  // 暴露到全局便于调试
  (window as any).__SS = Object.assign((window as any).__SS || {}, {
    _minimap: minimap,
    _grid: grid,
    _lodParams: params,
  });

  // 5) 像素估计：优先使用 app.estimatePx
  const estimatePx = (gi: number) => {
    try {
      if (typeof app.estimatePx === "function") return app.estimatePx(gi);
    } catch {}
    const cam = app.getCameraPose();
    const fx = cam.fx ?? 1000;
    const s = 0.02, z = 5.0; // 兜底
    return (fx * s) / Math.max(z, 1e-3);
  };

  // 6) 主循环（带异常保护，保证不掉帧）
  const tick = () => {
    try {
      const cam = app.getCameraPose();
      const draw = lod.filter(/* TODO: 视锥裁剪后用 cellsInView */ grid.cells, cam, estimatePx);
      try {
        app.setDrawIndices(draw);
      } catch (e) {
        // 未接上渲染也不阻塞小地图更新
        // console.warn("[addons] setDrawIndices failed:", e);
      }
      minimap.draw({ x: cam.position[0], z: cam.position[2] }, cam.yaw);
    } catch (e) {
      console.error("[addons] tick error:", e);
    } finally {
      requestAnimationFrame(tick);
    }
  };

  requestAnimationFrame(tick);
}
