/**
 * Minimal DOM globals required by `pdfjs-dist` (the engine behind `pdf-parse`)
 * when it runs under Node.
 *
 * WHY THIS EXISTS — the Amplify SSR 500 on `/api/parse`:
 *   pdfjs-dist's legacy Node build expects `DOMMatrix`, `ImageData`, and
 *   `Path2D` to exist on `globalThis`. In a browser they're built in; under
 *   Node, pdfjs tries to borrow them from the optional native package
 *   `@napi-rs/canvas` (see `node_utils` in pdf.mjs: `if (!globalThis.DOMMatrix)
 *   { globalThis.DOMMatrix = require('@napi-rs/canvas').DOMMatrix }`).
 *
 *   On a normal machine that native package loads and everything works — which
 *   is why this never reproduced locally. But on the Amplify Lambda the bundled
 *   `.next` compute output does NOT ship the native `@napi-rs/canvas` binary, so
 *   the require fails ("Cannot load @napi-rs/canvas"), `DOMMatrix` stays
 *   undefined, and the very first module-scope `new DOMMatrix()` inside pdfjs
 *   throws `ReferenceError: DOMMatrix is not defined` at module-evaluation time —
 *   before our route handler (and its try/catch) ever runs, surfacing as an
 *   opaque 500.
 *
 * THE FIX — define these globals ourselves BEFORE pdfjs is imported. Because
 *   pdfjs only reaches for `@napi-rs/canvas` when the globals are missing
 *   (`if (!globalThis.DOMMatrix)`), providing them removes the native dependency
 *   from the parse path entirely and makes the behaviour deterministic across
 *   darwin and the Amplify Linux runtime.
 *
 * SCOPE — Cashight only extracts TEXT from statements; it never rasterises a
 *   page. `ImageData`/`Path2D` are rendering-only and are provided as inert
 *   stubs purely so pdfjs's module body evaluates. `DOMMatrix` gets a correct
 *   2-D affine implementation so any incidental matrix math stays accurate. The
 *   parser acceptance numbers (see scripts/test-parser.ts) are the regression
 *   guard that this substitution does not change extraction output.
 */

/** A faithful-enough 2-D affine matrix: [a c e / b d f / 0 0 1]. */
class DOMMatrixPolyfill {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;

  constructor(init?: number[] | string) {
    if (Array.isArray(init)) {
      if (init.length === 6) {
        [this.a, this.b, this.c, this.d, this.e, this.f] = init;
      } else if (init.length === 16) {
        // 4x4 column-major → take the 2-D components (m11,m12,m21,m22,m41,m42).
        this.a = init[0];
        this.b = init[1];
        this.c = init[4];
        this.d = init[5];
        this.e = init[12];
        this.f = init[13];
      }
    } else if (typeof init === 'string') {
      const m = init.match(/matrix\(([^)]+)\)/);
      if (m) {
        const n = m[1].split(',').map((x) => parseFloat(x.trim()));
        if (n.length === 6) [this.a, this.b, this.c, this.d, this.e, this.f] = n;
      }
    }
  }

  get is2D(): boolean {
    return true;
  }

  get isIdentity(): boolean {
    return (
      this.a === 1 &&
      this.b === 0 &&
      this.c === 0 &&
      this.d === 1 &&
      this.e === 0 &&
      this.f === 0
    );
  }

  /** this * other (other applied first), returned as a new matrix. */
  multiply(o: DOMMatrixPolyfill): DOMMatrixPolyfill {
    const r = new DOMMatrixPolyfill();
    r.a = this.a * o.a + this.c * o.b;
    r.b = this.b * o.a + this.d * o.b;
    r.c = this.a * o.c + this.c * o.d;
    r.d = this.b * o.c + this.d * o.d;
    r.e = this.a * o.e + this.c * o.f + this.e;
    r.f = this.b * o.e + this.d * o.f + this.f;
    return r;
  }

  multiplySelf(o: DOMMatrixPolyfill): this {
    Object.assign(this, this.multiply(o));
    return this;
  }

  preMultiplySelf(o: DOMMatrixPolyfill): this {
    Object.assign(this, o.multiply(this));
    return this;
  }

  translate(tx = 0, ty = 0): DOMMatrixPolyfill {
    const t = new DOMMatrixPolyfill([1, 0, 0, 1, tx, ty]);
    return this.multiply(t);
  }

  translateSelf(tx = 0, ty = 0): this {
    Object.assign(this, this.translate(tx, ty));
    return this;
  }

  scale(sx = 1, sy = sx): DOMMatrixPolyfill {
    const s = new DOMMatrixPolyfill([sx, 0, 0, sy, 0, 0]);
    return this.multiply(s);
  }

  scaleSelf(sx = 1, sy = sx): this {
    Object.assign(this, this.scale(sx, sy));
    return this;
  }

  /** In-place inverse of the 2-D affine matrix. */
  invertSelf(): this {
    const det = this.a * this.d - this.b * this.c;
    if (det === 0) {
      this.a = this.b = this.c = this.d = this.e = this.f = NaN;
      return this;
    }
    const { a, b, c, d, e, f } = this;
    this.a = d / det;
    this.b = -b / det;
    this.c = -c / det;
    this.d = a / det;
    this.e = (c * f - d * e) / det;
    this.f = (b * e - a * f) / det;
    return this;
  }

  inverse(): DOMMatrixPolyfill {
    return new DOMMatrixPolyfill([this.a, this.b, this.c, this.d, this.e, this.f]).invertSelf();
  }

  transformPoint(p: { x?: number; y?: number } = {}): { x: number; y: number; z: number; w: number } {
    const x = p.x ?? 0;
    const y = p.y ?? 0;
    return { x: this.a * x + this.c * y + this.e, y: this.b * x + this.d * y + this.f, z: 0, w: 1 };
  }
}

/** Rendering-only stub: never exercised on Cashight's text-extraction path. */
class ImageDataPolyfill {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  constructor(widthOrData: number | Uint8ClampedArray, heightOrWidth?: number, height?: number) {
    if (typeof widthOrData === 'number') {
      this.width = widthOrData;
      this.height = heightOrWidth ?? 0;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    } else {
      this.data = widthOrData;
      this.width = heightOrWidth ?? 0;
      this.height = height ?? (this.width ? widthOrData.length / 4 / this.width : 0);
    }
  }
}

/** Rendering-only stub: never exercised on Cashight's text-extraction path. */
class Path2DPolyfill {
  addPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  bezierCurveTo(): void {}
  quadraticCurveTo(): void {}
  arc(): void {}
  arcTo(): void {}
  ellipse(): void {}
  rect(): void {}
  closePath(): void {}
}

/**
 * Idempotently install the DOM globals pdfjs needs. Safe to call multiple times
 * and a no-op if a real implementation (browser, or @napi-rs/canvas that did
 * load) is already present — we only fill genuine gaps.
 */
export function installPdfDomPolyfills(): void {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.DOMMatrix === 'undefined') g.DOMMatrix = DOMMatrixPolyfill;
  if (typeof g.ImageData === 'undefined') g.ImageData = ImageDataPolyfill;
  if (typeof g.Path2D === 'undefined') g.Path2D = Path2DPolyfill;
}

// Install on import so that simply importing this module before `pdf-parse`
// guarantees the globals exist by the time pdfjs's module body evaluates.
installPdfDomPolyfills();
