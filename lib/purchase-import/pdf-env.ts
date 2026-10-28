// Must be imported before `pdf-parse` (see pdf.ts). It prepares the two things
// pdfjs-dist (pdf-parse's engine) needs from its host that neither Node nor
// Cloudflare Workers provide out of the box:
//
// 1. `DOMMatrix` — pdfjs constructs one at module load time, so the import
//    itself throws "DOMMatrix is not defined" without it. On Node, pdfjs would
//    borrow it from the native `@napi-rs/canvas` package, but native addons
//    can't run on Workers. Text and table extraction only need plain 2D
//    affine math, so this small pure-JS matrix covers it everywhere.
// 2. The pdfjs worker — pdfjs normally `import()`s its worker script at
//    runtime, which Workers forbid. Handing it the worker's message handler
//    up front makes it run the parser on the main thread instead.
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";

type Init = ArrayLike<number> | undefined;

class AffineMatrix {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;

  constructor(init?: Init | string) {
    if (init && typeof init !== "string" && init.length >= 6) {
      if (init.length === 16) {
        this.a = init[0]; this.b = init[1]; this.c = init[4];
        this.d = init[5]; this.e = init[12]; this.f = init[13];
      } else {
        [this.a, this.b, this.c, this.d, this.e, this.f] = Array.from(init).slice(0, 6);
      }
    }
  }

  get m11() { return this.a; } get m12() { return this.b; }
  get m21() { return this.c; } get m22() { return this.d; }
  get m41() { return this.e; } get m42() { return this.f; }
  get is2D() { return true; }
  get isIdentity() {
    return this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0;
  }

  private set6(a: number, b: number, c: number, d: number, e: number, f: number) {
    this.a = a; this.b = b; this.c = c; this.d = d; this.e = e; this.f = f;
    return this;
  }

  // this = this × other
  multiplySelf(o: AffineMatrix | Init) {
    const m = o instanceof AffineMatrix ? o : new AffineMatrix(o);
    return this.set6(
      this.a * m.a + this.c * m.b,
      this.b * m.a + this.d * m.b,
      this.a * m.c + this.c * m.d,
      this.b * m.c + this.d * m.d,
      this.a * m.e + this.c * m.f + this.e,
      this.b * m.e + this.d * m.f + this.f
    );
  }

  // this = other × this
  preMultiplySelf(o: AffineMatrix | Init) {
    const m = o instanceof AffineMatrix ? o : new AffineMatrix(o);
    return this.set6(
      m.a * this.a + m.c * this.b,
      m.b * this.a + m.d * this.b,
      m.a * this.c + m.c * this.d,
      m.b * this.c + m.d * this.d,
      m.a * this.e + m.c * this.f + m.e,
      m.b * this.e + m.d * this.f + m.f
    );
  }

  invertSelf() {
    const det = this.a * this.d - this.b * this.c;
    if (!det) return this.set6(NaN, NaN, NaN, NaN, NaN, NaN);
    return this.set6(
      this.d / det,
      -this.b / det,
      -this.c / det,
      this.a / det,
      (this.c * this.f - this.d * this.e) / det,
      (this.b * this.e - this.a * this.f) / det
    );
  }

  translateSelf(tx = 0, ty = 0) { return this.multiplySelf([1, 0, 0, 1, tx, ty]); }
  scaleSelf(sx = 1, sy = sx) { return this.multiplySelf([sx, 0, 0, sy, 0, 0]); }

  multiply(o: AffineMatrix | Init) { return this.clone().multiplySelf(o); }
  inverse() { return this.clone().invertSelf(); }
  translate(tx?: number, ty?: number) { return this.clone().translateSelf(tx, ty); }
  scale(sx?: number, sy?: number) { return this.clone().scaleSelf(sx, sy); }
  clone() { return new AffineMatrix([this.a, this.b, this.c, this.d, this.e, this.f]); }

  transformPoint(p: { x?: number; y?: number } = {}) {
    const x = p.x ?? 0;
    const y = p.y ?? 0;
    return { x: this.a * x + this.c * y + this.e, y: this.b * x + this.d * y + this.f, z: 0, w: 1 };
  }

  toFloat32Array() { return new Float32Array([this.a, this.b, 0, 0, this.c, this.d, 0, 0, 0, 0, 1, 0, this.e, this.f, 0, 1]); }
  toFloat64Array() { return new Float64Array([this.a, this.b, 0, 0, this.c, this.d, 0, 0, 0, 0, 1, 0, this.e, this.f, 0, 1]); }
}

const g = globalThis as any;
if (!g.DOMMatrix) {
  g.DOMMatrix = AffineMatrix;
}
if (!g.pdfjsWorker) {
  g.pdfjsWorker = pdfjsWorker;
}
