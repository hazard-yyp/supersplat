// src/addons/supersplat-adapter.ts
//
// 作用：把 SuperSplat / PlayCanvas 封装成一个统一的 app 适配层，给 addons 使用。
// 暴露：getPositions / setDrawIndices(增量+节流) / getCameraPose / flyTo / estimatePx
//

export function makeSupersplatAppAdapter(editor?: any) {
  const SS = (window as any).__SS || {};
  const pcApp: any = SS.pcApp || editor?.scene?.app || editor?.app?.app || null;

  // ---------- 拿到当前 Splat / 数据 ----------
  const splat: any = (() => {
    const e = editor || SS.editor || null;
    if (!e) return null;
    return (e as any).splat || (e as any).scene?.splat || null;
  })();
  if (!splat) {
    console.warn("[adapter] no splat instance yet");
  }

  const splatData: any = splat?.splatData || SS.splatData || null;
  const N: number = splatData?.numSplats || 0;

  // 顶点属性（可能不存在则给空）
  const x = (splatData && (splatData.getProp?.('x') as Float32Array)) || new Float32Array(0);
  const y = (splatData && (splatData.getProp?.('y') as Float32Array)) || new Float32Array(0);
  const z = (splatData && (splatData.getProp?.('z') as Float32Array)) || new Float32Array(0);
  const s0 = (splatData && (splatData.getProp?.('scale_0') as Float32Array)) || new Float32Array(0);
  const s1 = (splatData && (splatData.getProp?.('scale_1') as Float32Array)) || new Float32Array(0);
  const s2 = (splatData && (splatData.getProp?.('scale_2') as Float32Array)) || new Float32Array(0);

  // 将 x/y/z 打包成 positions（只构建一次，后续复用）
  const positions = (() => {
    if (!N || !x?.length || !y?.length || !z?.length) return new Float32Array(0);
    const out = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      out[i * 3 + 0] = x[i];
      out[i * 3 + 1] = y[i];
      out[i * 3 + 2] = z[i];
    }
    return out;
  })();

  // 确保有 state 属性（Uint8Array，1=绘制，0=不绘制）
  let state: Uint8Array = (() => {
    if (!splatData) return new Uint8Array(0);
    let st = splatData.getProp?.('state') as Uint8Array;
    if (!st) {
      // 某些版本需要手动添加
      splatData.getElement?.('vertex')?.properties?.push?.({
        name: 'state',
        type: 'uchar',
        storage: (st = new Uint8Array(N))
      });
    }
    return st || new Uint8Array(0);
  })();

  const splatInstance: any = splat || null;

  // ---------- 工具函数 ----------
  const arr3 = (v: any): [number, number, number] => {
    if (!v) return [0, 0, 0];
    if (Array.isArray(v) && v.length >= 3) return [v[0], v[1], v[2]];
    if (typeof v.x === "number" && typeof v.y === "number" && typeof v.z === "number") return [v.x, v.y, v.z];
    if (typeof v.get === "function") {
      const t = v.get();
      if (Array.isArray(t) && t.length >= 3) return [t[0], t[1], t[2]];
    }
    return [0, 0, 0];
  };

  function findCameraEntity(): any {
    if (SS._camEnt && SS._camEnt.enabled && SS._camEnt.camera?.enabled) return SS._camEnt;
    const root = pcApp?.root;
    if (!root) return null;

    const cams: any[] = [];
    const stack = [root];
    while (stack.length) {
      const e: any = stack.pop();
      if (!e) continue;
      if (e.camera) cams.push(e);
      if (e.children) for (let i = 0; i < e.children.length; i++) stack.push(e.children[i]);
    }

    let best: any = null;
    let bestP = +Infinity;
    for (const e of cams) {
      const enabled = !!(e.enabled && e.camera?.enabled);
      const p = typeof e.camera?.priority === "number" ? e.camera.priority : 1000;
      if (enabled && p < bestP) { best = e; bestP = p; }
    }
    if (!best && cams.length) best = cams[0];
    (window as any).__SS = Object.assign(SS, { _camEnt: best || null });
    return best;
  }

  function collectAncestorScripts(e: any): any[] {
    const arr: any[] = [];
    let cur = e;
    while (cur) {
      if (cur.script) arr.push(cur.script);
      cur = cur.parent;
    }
    return arr;
  }
  function setScriptsEnabled(scripts: any[], enabled: boolean) {
    for (const s of scripts) {
      try {
        if (typeof s.enabled === "boolean") s.enabled = enabled;
      } catch {}
    }
  }

  // ---------- 预计算 baseScale（大幅降低 estimatePx 成本） ----------
  const baseScale = (() => {
    const out = new Float32Array(N || 0);
    if (N && s0?.length && s1?.length && s2?.length) {
      for (let i = 0; i < N; i++) {
        const m = Math.max(s0[i], s1[i], s2[i]);
        out[i] = Math.exp(m);
      }
    }
    return out;
  })();

  // ---------- 适配 API ----------
  const getPositions = (): Float32Array => positions;

  // 增量+节流版 setDrawIndices
  let _lastIndices = new Uint32Array(0);
  let _lastAppliedAt = 0;
  let _APPLY_EVERY_MS = 80; // 默认 80ms 应用一次

  const setDrawIndices = (indices: Uint32Array) => {
    if (!state?.length) return;
    const now = performance.now();

    // 仅改“变化的位”
    for (let i = 0; i < _lastIndices.length; i++) state[_lastIndices[i]] = 0;
    for (let i = 0; i < indices.length; i++)      state[indices[i]] = 1;

    const shouldApply = (now - _lastAppliedAt) >= _APPLY_EVERY_MS;
    if (shouldApply) {
      if (splatInstance?.updateState) splatInstance.updateState(1);
      else if (splatInstance?.refresh) splatInstance.refresh();
      else if (splatInstance?.update)  splatInstance.update();
      _lastAppliedAt = now;
    }
    _lastIndices = indices.slice();
  };

  const getCameraPose = () => {
    const camEnt: any = findCameraEntity();
    const pos = camEnt?.getPosition ? camEnt.getPosition() : (camEnt?.position || { x: 0, y: 0, z: 0 });
    const p = arr3(pos);
    let yaw = 0;
    try {
      // 从前向量求 yaw（在 XZ 平面上，右手坐标）
      const f = camEnt.forward || camEnt._forward;
      const fv = arr3(f || { x: 0, y: 0, z: -1 });
      yaw = Math.atan2(fv[0], fv[2]); // X 对 Z
    } catch {}
    // 估 fx（用垂直 fov）
    let fx = 1000;
    try {
      const cam = camEnt.camera;
      const fovy = (cam?.fov ?? 60) * Math.PI / 180;
      const h = pcApp?.graphicsDevice?.height || (document.querySelector('canvas') as HTMLCanvasElement)?.height || 1080;
      const fy = 0.5 * h / Math.tan(0.5 * fovy);
      fx = fy; // 这里用 fy 近似 fx，足够用于阈值比较
    } catch {}
    return { position: p as [number, number, number], yaw, fx };
  };

  const flyTo = ({ x, y, z }: { x:number; y:number; z:number }, ms=900) => {
    const camEnt: any = findCameraEntity();
    if (!camEnt) return;

    const movable = camEnt.parent || camEnt;
    const p0 = arr3(movable.getPosition ? movable.getPosition() : movable.position) as [number, number, number];

    const ancestorScripts = collectAncestorScripts(camEnt);
    setScriptsEnabled(ancestorScripts, false);

    const ctrl =
      (camEnt.script && (camEnt.script.orbitCamera || camEnt.script.controller || camEnt.script.firstPerson || camEnt.script.flyCamera)) ||
      camEnt.orbit || camEnt.orbitCamera || camEnt.controller || null;
    (window as any).__SS._camCtrl = ctrl || undefined;

    const t0 = performance.now();
    const step = (t:number) => {
      const k = Math.min(1, (t - t0)/ms);
      const s = k < 0.5 ? 2*k*k : -1 + (4 - 2*k)*k; // easeInOut
      const nx = p0[0] + (x - p0[0]) * s;
      const ny = p0[1] + (y - p0[1]) * s;
      const nz = p0[2] + (z - p0[2]) * s;

      if (movable.setLocalPosition) movable.setLocalPosition(nx, ny, nz);
      else if (movable.setPosition) movable.setPosition(nx, ny, nz);
      else if (movable.position?.set) movable.position.set(nx, ny, nz);

      if (k < 1) requestAnimationFrame(step);
      else {
        try {
          if (ctrl) {
            if (ctrl.pivotPoint?.set) ctrl.pivotPoint.set(x, y, z);
            if (ctrl.target?.set)     ctrl.target.set(x, y, z);
            if (typeof ctrl.setTarget === "function") ctrl.setTarget(x, y, z);
            if (typeof ctrl.lookAt === "function")    ctrl.lookAt(x, y, z);
            if (typeof ctrl.focus === "function" && (window as any).pc) {
              const v = new (window as any).pc.Vec3(x, y, z);
              ctrl.focus(v);
            }
          }
        } catch {}
        setScriptsEnabled(ancestorScripts, true);
      }
    };
    requestAnimationFrame(step);
  };

  const estimatePx = (i: number): number => {
    if (!positions.length || !baseScale.length) return 0;
    const pose = getCameraPose();
    const px = positions[3*i+0], py = positions[3*i+1], pz = positions[3*i+2];
    const dx = px - pose.position[0], dy = py - pose.position[1], dz = pz - pose.position[2];
    const dist = Math.max(1e-3, Math.hypot(dx, dy, dz));
    return (pose.fx * baseScale[i]) / dist;
  };

  // 暴露一些调试入口
  (window as any).__SS = Object.assign(SS, {
    app: { getPositions, setDrawIndices, getCameraPose, flyTo, estimatePx },
    setLodApplyEvery(ms: number) { _APPLY_EVERY_MS = Math.max(0, (ms|0)); }
  });

  return { getPositions, setDrawIndices, getCameraPose, flyTo, estimatePx };
}

export default makeSupersplatAppAdapter;
