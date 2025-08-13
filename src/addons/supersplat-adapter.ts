// src/addons/supersplat-adapter.ts
type Vec3 = [number, number, number];

function arr3(a: any): Vec3 {
  if (Array.isArray(a)) return [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0];
  if (a && typeof a.x === "number") return [a.x, a.y, a.z];
  return [0, 1.6, 3];
}

function getCanvasSize(): { width: number; height: number } {
  const c = document.querySelector("canvas") as HTMLCanvasElement | null;
  return { width: c?.width || innerWidth, height: c?.height || innerHeight };
}

function computeFxFromFovY(fovYRad: number): number {
  const { height } = getCanvasSize();
  return height / (2 * Math.tan(fovYRad * 0.5));
}

function expMaxScale(s0: number, s1: number, s2: number): number {
  const m = Math.max(s0, s1, s2);
  return Math.exp(m);
}

export function makeSupersplatAppAdapter() {
  const SS = (window as any).__SS || {};
  const editor = SS.editor;
  const splatData = SS.splatData;
  if (!splatData) throw new Error("[adapter] splatData not found. Load a .ply first.");

  const N: number = splatData.numSplats ?? 0;
  if (!N) throw new Error("[adapter] numSplats is 0 - load a .ply first.");

  const x = splatData.getProp('x') as Float32Array;
  const y = splatData.getProp('y') as Float32Array;
  const z = splatData.getProp('z') as Float32Array;
  const s0 = splatData.getProp('scale_0') as Float32Array;
  const s1 = splatData.getProp('scale_1') as Float32Array;
  const s2 = splatData.getProp('scale_2') as Float32Array;

  const positions = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { positions[3*i+0]=x[i]; positions[3*i+1]=y[i]; positions[3*i+2]=z[i]; }

  // ====== 相机：自动发现 PlayCanvas 的 camera 实体 ======
  const scene = editor?.scene;
  const pcApp = (window as any).__SS?.pcApp || scene?.app || editor?.app?.app;

  if (!pcApp?.root) console.warn("[adapter] PlayCanvas app not found on editor.scene; camera auto-find may fail");

function findCameraEntity(): any {
  // 已缓存且可用
  if ((window as any).__SS?._camEnt && (window as any).__SS._camEnt.enabled && (window as any).__SS._camEnt.camera?.enabled) {
    return (window as any).__SS._camEnt;
  }
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

  (window as any).__SS = Object.assign((window as any).__SS || {}, { _camEnt: best || null });
  return best;
}



  function arr3(a: any): [number, number, number] {
    if (Array.isArray(a)) return [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0];
    if (a && typeof a.x === "number") return [a.x, a.y, a.z];
    return [0, 1.6, 3];
  }

  function getCanvasSize(): { width: number; height: number } {
    const c = document.querySelector("canvas") as HTMLCanvasElement | null;
    return { width: c?.width || innerWidth, height: c?.height || innerHeight };
  }

  function computeFxFromFovY(fovYRad: number): number {
    const { height } = getCanvasSize();
    return height / (2 * Math.tan(fovYRad * 0.5));
  }

  function expMaxScale(s0: number, s1: number, s2: number): number {
    const m = Math.max(s0, s1, s2);
    return Math.exp(m);
  }

  const getCameraPose = () => {
    const camEnt: any = findCameraEntity();
    // 读位置
    let pos: [number, number, number] = [0, 1.6, 3];
    if (camEnt?.getPosition) pos = arr3(camEnt.getPosition());
    else if (camEnt?.position) pos = arr3(camEnt.position);

    // 读朝向（用于小地图扇形）
    let yaw = 0;
    try {
      // PlayCanvas 实体有 forward 向量
      const fwd = camEnt?.forward || camEnt?.getForward?.();
      if (fwd) {
        const fv = arr3(fwd);
        yaw = Math.atan2(fv[0], fv[2]); // X-Z 平面
      }
    } catch {}

    // 读投影（fov → fx）
    let fx = 1000;
    try {
      const fovYDeg = camEnt?.camera?.fov ?? camEnt?.camera?.fovY ?? 60;
      fx = computeFxFromFovY((fovYDeg * Math.PI) / 180);
    } catch {}

    return { position: pos, yaw, fx };
  };

  const estimatePx = (i: number): number => {
    const pose = getCameraPose();
    const px = positions[3*i+0], py = positions[3*i+1], pz = positions[3*i+2];
    const dx = px - pose.position[0], dy = py - pose.position[1], dz = pz - pose.position[2];
    const dist = Math.max(1e-3, Math.hypot(dx, dy, dz));
    const s = (s0 && s1 && s2) ? expMaxScale(s0[i], s1[i], s2[i]) : 0.02;
    return (pose.fx * s) / dist;
  };

  // ====== 把 LOD 结果写回（state 掩码 + 刷新）======
  let state = splatData.getProp('state') as Uint8Array;
  if (!state) {
    state = new Uint8Array(N);
    if (splatData.addProp) splatData.addProp('state', state);
  }

  const findSplatInstance = () => {
    const arr = (scene?.elements || []);
    for (const it of arr) {
      if (it?.splatData === splatData || it?.asset?.resource?.splatData === splatData) return it;
    }
    return editor?.currentSplat || editor?.viewer?.splat || null;
  };
  const splatInstance = findSplatInstance();

  const setDrawIndices = (indices: Uint32Array) => {
    state.fill(0);
    for (let k = 0; k < indices.length; k++) state[indices[k]] = 1;
    if (splatInstance?.updateState) splatInstance.updateState(1);
    else if (splatInstance?.refresh) splatInstance.refresh();
    else if (splatInstance?.update) splatInstance.update();
  };

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

const flyTo = ({ x, y, z }: { x:number; y:number; z:number }, ms=900) => {
  const camEnt: any = findCameraEntity();
  if (!camEnt) return;

  // 若相机有父节点，通常父节点才是控制/轨道的枢轴：优先移动父节点
  const movable = camEnt.parent || camEnt;

  // 起点：用“可移动节点”的世界坐标
  // ✅ 正确：用 arr3 把 Vec3/array/对象统一成 [x,y,z]
  const p0 = arr3(movable.getPosition ? movable.getPosition() : movable.position) as [number, number, number];

  // 收集并暂时禁用“祖先链”上的脚本，避免每帧抢回位置
  const ancestorScripts = collectAncestorScripts(camEnt);
  setScriptsEnabled(ancestorScripts, false);

  // 尝试找常见控制器引用（命中就同步 target/pivot）
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

    if (k < 1) {
      requestAnimationFrame(step);
    } else {
      // 结束：同步控制器的目标/枢轴，防止下一帧拉回，并恢复脚本开关
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





  // 暴露给外部调试
  (window as any).__SS = Object.assign(SS, {
    _camEnt: (window as any).__SS?._camEnt || undefined
  });

  return {
    getPositions: () => positions,
    getCameraPose,
    setDrawIndices,
    flyTo,
    estimatePx
  };
}
