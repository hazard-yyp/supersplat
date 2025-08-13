// src/addons/minimap/MinimapOverlay.ts
type Bounds3 = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
type Axis = 'XZ' | 'XY';

export class MinimapOverlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(
    private bounds: Bounds3,
    private onPick: (x: number, second: number) => void,
    private axis: Axis = 'XZ'
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = 240;
    this.canvas.height = 240;
    Object.assign(this.canvas.style, {
      position: "fixed",
      right: "12px",
      bottom: "12px",
      zIndex: "2147483647",
      background: "rgba(30,30,30,0.85)",
      border: "1px solid rgba(255,255,255,0.2)",
      borderRadius: "8px",
      userSelect: "none",
      pointerEvents: "auto"
    } as CSSStyleDeclaration);
    document.body.appendChild(this.canvas);

    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Minimap 2D context failed");
    this.ctx = ctx;

    this.canvas.addEventListener("click", (e) => this.handleClick(e));
  }

  dispose() { this.canvas.remove(); }
  public getCanvas(): HTMLCanvasElement { return this.canvas; }

  draw(cameraPos: { x: number; y?: number; z?: number }, cameraYawRad?: number) {
    const { width, height } = this.canvas;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, width, height);

    // 边框
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.strokeRect(0, 0, width, height);

    // 相机位置点
    const second = this.axis === 'XY' ? (cameraPos.y ?? 0) : (cameraPos.z ?? 0);
    const p = this.worldToMini(cameraPos.x, second);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath(); ctx.arc(p.u, p.v, 4, 0, Math.PI * 2); ctx.fill();

    if (typeof cameraYawRad === "number") this.drawFOV(p.u, p.v, cameraYawRad, Math.PI / 6, 28);
  }

  private drawFOV(cx: number, cy: number, yaw: number, halfAngle: number, r: number) {
    const ctx = this.ctx;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, yaw - halfAngle, yaw + halfAngle);
    ctx.closePath(); ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fill();
  }

  private handleClick(e: MouseEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const u = e.clientX - rect.left, v = e.clientY - rect.top;
    const { x, second } = this.miniToWorld(u, v);
    this.onPick(x, second);
  }

  private worldToMini(x: number, second: number) {
    const c = this.canvas;
    const { minX, maxX, minY, maxY, minZ, maxZ } = this.bounds;
    const minS = (this.axis === 'XY') ? minY : minZ;
    const maxS = (this.axis === 'XY') ? maxY : maxZ;
    const u = ((x - minX) / (maxX - minX)) * c.width;
    const v = ((second - minS) / (maxS - minS)) * c.height;
    return { u, v };
  }

  private miniToWorld(u: number, v: number) {
    const c = this.canvas;
    const { minX, maxX, minY, maxY, minZ, maxZ } = this.bounds;
    const x = minX + (u / c.width) * (maxX - minX);
    const minS = (this.axis === 'XY') ? minY : minZ;
    const maxS = (this.axis === 'XY') ? maxY : maxZ;
    const second = minS + (v / c.height) * (maxS - minS);
    return { x, second };
  }
}
