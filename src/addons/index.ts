// src/addons/index.ts
import { buildGridIndex } from "./lod/GridIndex";
import { LodManager, type LodParams } from "./lod/LodManager";
import { MinimapOverlay } from "./minimap/MinimapOverlay";
import { Hud } from "./hud/Hud";

/**
 * 需要的 app 接口（由 supersplat-adapter 提供）：
 *  - getCameraPose(): { position:[number,number,number], yaw?:number, fx?:number }
 *  - getPositions(): Float32Array
 *  - setDrawIndices(indices: Uint32Array): void   // 已做增量+节流
 *  - flyTo({x,y,z}, ms?:number): void
 *  - estimatePx?(i: number): number
 */
export function setup(app: any) {
  console.log("[addons] setup() called");

  // --- 1) 读取点位（等待就绪，避免过早 return） ---
  function getPositionsNow(): Float32Array {
    try {
      return app.getPositions?.() ?? new Float32Array();
    } catch {
      return new Float32Array();
    }
  }

  async function waitPositionsReady(maxMs = 8000, stepMs = 50): Promise<Float32Array> {
    const t0 = performance.now();
    while (performance.now() - t0 < maxMs) {
      const p = getPositionsNow();
      if (p.length) return p;
      await new Promise((r) => setTimeout(r, stepMs));
    }
    throw new Error("[addons] positions not ready within timeout");
  }

  // 用 IIFE 包裹后续初始化，确保点位已就绪
  (async () => {
    const positions = await waitPositionsReady();
    const totalSplats = (positions.length / 3) | 0;

    // --- 2) 建网格索引 ---
    const grid = buildGridIndex(positions, { cellSize: 1.5, maxReprPerCell: 32 });

    // --- 3) LOD 参数（稍收紧，提升性能） ---
    const params: LodParams = {
      nearDist: 10,
      midDist: 28,
      maxPerCellNear: 256,
      maxPerCellMid: 64,
      screenPxThreshold: 1.5,
    };
    const lod = new LodManager(grid, params);

    // --- 4) 小地图（保持 XZ：横轴 X、竖轴 Z；点击仅改 X/Z，Y 保持不变） ---
    const bounds = {
      minX: grid.sceneAabb.min[0], maxX: grid.sceneAabb.max[0],
      minY: grid.sceneAabb.min[1], maxY: grid.sceneAabb.max[1],
      minZ: grid.sceneAabb.min[2], maxZ: grid.sceneAabb.max[2],
    };
    const minimap = new MinimapOverlay(bounds, (x, z) => {
      const cam = app.getCameraPose();
      app.flyTo({ x, y: cam.position[1], z }, 900);
    });

    (window as any).__SS = Object.assign((window as any).__SS || {}, {
      _minimap: minimap,
      _grid: grid,
      _lodParams: params,
    });

    // --- 5) HUD + LOD 开关（键盘捕获 + 屏幕按钮） ---
    const hud = new Hud();
    let lodEnabled = true;
    (window as any).__SS.lodEnabled = lodEnabled;

    const allIndices = (() => {
      const arr = new Uint32Array(totalSplats);
      for (let i = 0; i < totalSplats; i++) arr[i] = i;
      return arr;
    })();

    function isTypingTarget(t: EventTarget | null) {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName.toLowerCase();
      return tag === "input" || tag === "textarea" || t.isContentEditable === true;
    }

    function toggleLOD() {
      lodEnabled = !lodEnabled;
      (window as any).__SS.lodEnabled = lodEnabled;
      hud.setLodEnabled(lodEnabled);
      console.log(`[addons] LOD ${lodEnabled ? "ENABLED" : "DISABLED"}`);
    }

    window.addEventListener(
      "keydown",
      (e) => {
        const key = e.key?.toLowerCase?.();
        if ((key === "l" || key === "f9") && !e.repeat && !isTypingTarget(e.target)) {
          e.stopImmediatePropagation();
          e.preventDefault();
          toggleLOD();
        }
      },
      true
    );

    (window as any).__SS.toggleLOD = toggleLOD;

    // 屏幕按钮
    const lodBtn = document.createElement("button");
    lodBtn.textContent = `LOD: ${lodEnabled ? "on" : "off"}`;
    Object.assign(lodBtn.style, {
      position: "fixed",
      left: "12px",
      bottom: "72px",
      padding: "6px 10px",
      font: "12px/1 monospace",
      color: "#fff",
      background: "rgba(0,0,0,0.55)",
      border: "1px solid rgba(255,255,255,0.2)",
      borderRadius: "8px",
      zIndex: "2147483647",
      cursor: "pointer",
      pointerEvents: "auto",
    } as CSSStyleDeclaration);
    lodBtn.addEventListener("click", () => {
      toggleLOD();
      lodBtn.textContent = `LOD: ${lodEnabled ? "on" : "off"}`;
    });
    document.body.appendChild(lodBtn);

    const _oldSet = hud.setLodEnabled.bind(hud);
    hud.setLodEnabled = (enabled: boolean) => {
      _oldSet(enabled);
      lodBtn.textContent = `LOD: ${enabled ? "on" : "off"}`;
    };
    hud.setLodEnabled(lodEnabled);
    hud.setTotals(0, totalSplats);

    // --- 6) 像素估计：优先适配器版本 ---
    const estimatePx = (gi: number) => {
      try {
        if (typeof app.estimatePx === "function") return app.estimatePx(gi);
      } catch {}
      const cam = app.getCameraPose();
      const fx = cam.fx ?? 1000;
      const s = 0.02,
        z = 5.0;
      return (fx * s) / Math.max(z, 1e-3);
    };

    // --- 7) 主循环（加入“近似半径过滤”以减少参与格子） ---
    const tick = () => {
      try {
        const cam = app.getCameraPose();

        // 7.1 轻量粗过滤：仅处理半径 R 内的格子（可后续替换为视锥裁剪）
        const R = params.midDist * 1.5;
        const cx = cam.position[0],
          cy = cam.position[1],
          cz = cam.position[2];
        const cellsNearby = grid.cells.filter((cell) => {
          const a = cell.aabb;
          const mx = 0.5 * (a.min[0] + a.max[0]);
          const my = 0.5 * (a.min[1] + a.max[1]);
          const mz = 0.5 * (a.min[2] + a.max[2]);
          const d = Math.hypot(mx - cx, my - cy, mz - cz);
          return d <= R;
        });

        // 7.2 计算本帧绘制索引
        const draw = lodEnabled ? lod.filter(cellsNearby, cam, estimatePx) : allIndices;

        // 7.3 回写渲染端（适配器内部有节流 + 增量）
        try {
          app.setDrawIndices(draw);
        } catch {}

        // 7.4 HUD & 小地图
        hud.setTotals(draw.length, totalSplats);
        minimap.draw({ x: cam.position[0], z: cam.position[2] }, cam.yaw);
      } catch (e) {
        console.error("[addons] tick error:", e);
      } finally {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);

    console.log("[addons] LOD + minimap + HUD initialized");
  })().catch((e) => {
    console.error("[addons] init failed:", e);
  });

  // 立即返回，初始化在点位就绪后继续执行
  return;
}
