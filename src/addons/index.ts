// src/addons/index.ts
import { buildGridIndex } from "./lod/GridIndex";
import { LodManager, type LodParams } from "./lod/LodManager";
import { MinimapOverlay } from "./minimap/MinimapOverlay";
import { Hud } from "./hud/Hud";

export function setup(app: any) {
  console.log("[addons] setup() called");

  // 1) 取点位数据
  const positions: Float32Array = app.getPositions?.() ?? new Float32Array();
  if (!positions.length) {
    console.warn("[addons] positions empty; call setup AFTER .ply is loaded");
    return;
  }
  const totalSplats = positions.length / 3;

  // 2) 建网格索引
  const grid = buildGridIndex(positions, { cellSize: 1.5, maxReprPerCell: 32 });

  // 3) LOD 参数
  const params: LodParams = {
    nearDist: 12,
    midDist: 40,
    maxPerCellNear: 512,
    maxPerCellMid: 128,
    screenPxThreshold: 1.2,
  };
  const lod = new LodManager(grid, params);

  // 4) 小地图（保持你当前工作中的版本；如需 XOY 再单独改）
  const bounds = {
    minX: grid.sceneAabb.min[0], maxX: grid.sceneAabb.max[0],
    minY: grid.sceneAabb.min[1], maxY: grid.sceneAabb.max[1],
    minZ: grid.sceneAabb.min[2], maxZ: grid.sceneAabb.max[2],
  };
  const minimap = new MinimapOverlay(bounds, (x, zOrY) => {
    const cam = app.getCameraPose();
    // 这里按你当前的小地图平面决定是用 zOrY 作为 z 还是 y
    app.flyTo({ x, y: cam.position[1], z: zOrY }, 900); // ← 如果你要 XOY，请把这行改成 y:z 保持/改 y
  });
  (window as any).__SS = Object.assign((window as any).__SS || {}, {
    _minimap: minimap,
    _grid: grid,
    _lodParams: params,
  });

  // 5) HUD + 热键
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
  return tag === 'input' || tag === 'textarea' || t.isContentEditable === true;
}

function toggleLOD() {
  lodEnabled = !lodEnabled;
  (window as any).__SS.lodEnabled = lodEnabled;
  hud.setLodEnabled(lodEnabled);
  console.log(`[addons] LOD ${lodEnabled ? 'ENABLED' : 'DISABLED'}`);
}

// 捕获阶段抢在应用自己热键之前拦截
window.addEventListener('keydown', (e) => {
  const key = e.key?.toLowerCase?.();
  if ((key === 'l' || key === 'f9') && !e.repeat && !isTypingTarget(e.target)) {
    e.stopImmediatePropagation();
    e.preventDefault();
    toggleLOD();
  }
}, true);

// 也暴露个控制台开关
(window as any).__SS.toggleLOD = toggleLOD;

// 屏幕按钮：LOD on/off
const lodBtn = document.createElement('button');
lodBtn.textContent = `LOD: ${lodEnabled ? 'on' : 'off'}`;
Object.assign(lodBtn.style, {
  position: 'fixed',
  left: '12px',
  bottom: '72px',
  padding: '6px 10px',
  font: '12px/1 monospace',
  color: '#fff',
  background: 'rgba(0,0,0,0.55)',
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: '8px',
  zIndex: '2147483647',
  cursor: 'pointer',
  pointerEvents: 'auto'
} as CSSStyleDeclaration);
lodBtn.addEventListener('click', () => {
  toggleLOD();
  lodBtn.textContent = `LOD: ${lodEnabled ? 'on' : 'off'}`;
});
document.body.appendChild(lodBtn);

// 同步 HUD 时也顺便更新按钮文案
const _oldSet = hud.setLodEnabled.bind(hud);
hud.setLodEnabled = (enabled: boolean) => {
  _oldSet(enabled);
  lodBtn.textContent = `LOD: ${enabled ? 'on' : 'off'}`;
};



  hud.setLodEnabled(lodEnabled);
  hud.setTotals(0, totalSplats);

  // 6) 像素估计：优先适配器版本
  const estimatePx = (gi: number) => {
    try { if (typeof app.estimatePx === "function") return app.estimatePx(gi); } catch {}
    const cam = app.getCameraPose();
    const fx = cam.fx ?? 1000;
    const s = 0.02, z = 5.0;
    return (fx * s) / Math.max(z, 1e-3);
  };

  // 7) 主循环
  const tick = () => {
    try {
      const cam = app.getCameraPose();

      // 7.1 如果关 LOD，直接绘制全部；否则走 LOD
      const draw = lodEnabled
        ? lod.filter(grid.cells, cam, estimatePx)
        : allIndices;

      // 7.2 写回渲染端
      try { app.setDrawIndices(draw); } catch {}

      // 7.3 更新 HUD（实时显示当前绘制数量 / 总数）
      hud.setTotals(draw.length, totalSplats);

      // 7.4 小地图跟随
      minimap.draw({ x: cam.position[0], z: cam.position[2] }, cam.yaw);
    } catch (e) {
      console.error("[addons] tick error:", e);
    } finally {
      requestAnimationFrame(tick);
    }
  };
  requestAnimationFrame(tick);
}
