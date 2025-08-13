// src/addons/hud/Hud.ts
export class Hud {
  private box: HTMLDivElement;
  private fpsSpan: HTMLSpanElement;
  private drawSpan: HTMLSpanElement;
  private totalSpan: HTMLSpanElement;
  private lodSpan: HTMLSpanElement;

  private lastTime = performance.now();
  private frameCount = 0;
  private fps = 0;

  constructor() {
    this.box = document.createElement('div');
    Object.assign(this.box.style, {
      position: 'fixed',
      left: '12px',
      bottom: '12px',
      padding: '8px 10px',
      background: 'rgba(0,0,0,0.55)',
      color: '#fff',
      font: '12px/1.5 monospace',
      border: '1px solid rgba(255,255,255,0.2)',
      borderRadius: '8px',
      zIndex: '2147483647',
      pointerEvents: 'none',
      whiteSpace: 'nowrap'
    } as CSSStyleDeclaration);
    this.box.innerHTML = `
      <div>FPS: <span id="hud-fps">0</span></div>
      <div>Drawn: <span id="hud-draw">0</span> / <span id="hud-total">0</span></div>
      <div>LOD: <span id="hud-lod">on</span> (press "L" to toggle)</div>
    `;
    document.body.appendChild(this.box);

    this.fpsSpan   = this.box.querySelector('#hud-fps')  as HTMLSpanElement;
    this.drawSpan  = this.box.querySelector('#hud-draw') as HTMLSpanElement;
    this.totalSpan = this.box.querySelector('#hud-total') as HTMLSpanElement;
    this.lodSpan   = this.box.querySelector('#hud-lod')  as HTMLSpanElement;

    // 自己算 FPS（简单平均法）
    const tick = () => {
      this.frameCount++;
      const now = performance.now();
      if (now - this.lastTime >= 500) {
        this.fps = Math.round((this.frameCount * 1000) / (now - this.lastTime));
        this.frameCount = 0;
        this.lastTime = now;
        this.fpsSpan.textContent = String(this.fps);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  setTotals(drawCount: number, totalCount: number) {
    this.drawSpan.textContent = String(drawCount);
    this.totalSpan.textContent = String(totalCount);
  }

  setLodEnabled(enabled: boolean) {
    this.lodSpan.textContent = enabled ? 'on' : 'off';
  }

  dispose() { this.box.remove(); }
}
