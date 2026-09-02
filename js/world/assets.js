
"use strict";

/* ------------------------------------------------------------------
   SHARED GEOMETRY / MATERIALS / PROCEDURAL TEXTURES
   Swap CONFIG.textures.* to local files later without changing materials.
   ------------------------------------------------------------------ */
const Geometries = {};
const Materials = {};
const TextureFactory = {
  loader: null,
  makeCanvas(size) {
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    return c;
  },
  hash(x, y) {
    let n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  },
  noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const h = this.hash.bind(this);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  },
  fbm(x, y) {
    return this.noise(x, y) * 0.55 + this.noise(x * 2.1, y * 2.1) * 0.3 + this.noise(x * 4.3, y * 4.3) * 0.15;
  },
  toTexture(canvas) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  },
  fromConfigOrCanvas(key, builder) {
    if (CONFIG.textures[key] && this.loader) {
      const tex = this.loader.load(CONFIG.textures[key]);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      return tex;
    }
    return builder();
  },
  wallpaper(seed, warmth) {
    const size = 512;
    const c = this.makeCanvas(size);
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(size, size);
    const d = img.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = this.fbm(x * 0.035 + seed, y * 0.05 + seed * 1.7);
        const n2 = this.fbm(x * 0.12 + 9, y * 0.09 + 4);
        const stripe = Math.sin((x + n2 * 6) * Math.PI * 2 / 18) * 0.5 + 0.5;
        const fine = this.hash(x * 0.7 + seed, y * 1.9) * 0.08;
        let stain = this.fbm(x * 0.02 + seed * 3, y * 0.018);
        stain = stain > 0.62 ? (stain - 0.62) * 0.55 : 0;
        const speckle = this.hash(x + y * 13 + seed * 20, y * 3) > 0.97 ? 0.07 : 0;
        const baseR = 226 + warmth;
        const baseG = 206 + warmth * 0.4;
        const baseB = 108 + warmth * 0.15;
        let r = baseR + (n - 0.5) * 22 + stripe * 10 - stain * 38 - speckle * 40 + fine * 20;
        let g = baseG + (n - 0.5) * 18 + stripe * 8 - stain * 32 - speckle * 30 + fine * 16;
        let b = baseB + (n - 0.5) * 10 + stripe * 4 - stain * 18 + fine * 8;
        const i = (y * size + x) * 4;
        d[i] = Math.max(0, Math.min(255, r));
        d[i + 1] = Math.max(0, Math.min(255, g));
        d[i + 2] = Math.max(0, Math.min(255, b));
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return this.toTexture(c);
  },
  carpet() {
    const size = 512;
    const c = this.makeCanvas(size);
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(size, size);
    const d = img.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = this.fbm(x * 0.08, y * 0.08);
        const fiber = this.hash(x * 3.1, y * 0.4) * 0.12 + this.hash(x * 0.3, y * 2.7) * 0.1;
        const fleck = this.hash(x * 1.7, y * 2.3) > 0.93 ? -18 : 0;
        const r = 188 + (n - 0.5) * 28 + fiber * 22 + fleck;
        const g = 154 + (n - 0.5) * 22 + fiber * 14 + fleck * 0.7;
        const b = 62 + (n - 0.5) * 12 + fiber * 6;
        const i = (y * size + x) * 4;
        d[i] = Math.max(0, Math.min(255, r));
        d[i + 1] = Math.max(0, Math.min(255, g));
        d[i + 2] = Math.max(0, Math.min(255, b));
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return this.toTexture(c);
  },
  concrete() {
    const size = 512;
    const c = this.makeCanvas(size);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#8a8a84";
    ctx.fillRect(0, 0, size, size);
    const img = ctx.getImageData(0, 0, size, size);
    const d = img.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = this.fbm(x * 0.035, y * 0.035);
        const n2 = this.fbm(x * 0.12, y * 0.12);
        const stain = this.hash(x * 0.07, y * 0.09) > 0.97 ? -22 : 0;
        const i = (y * size + x) * 4;
        const v = 128 + (n - 0.5) * 28 + (n2 - 0.5) * 14 + stain;
        d[i] = Math.max(70, Math.min(170, v));
        d[i + 1] = Math.max(70, Math.min(168, v - 2));
        d[i + 2] = Math.max(66, Math.min(160, v - 8));
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return this.toTexture(c);
  },
  chainlink() {
    const size = 256;
    const c = this.makeCanvas(size);
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = "rgba(40,40,38,0.92)";
    ctx.lineWidth = 3;
    const cell = 16;
    for (let y = -size; y < size * 2; y += cell) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y + size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(size, y);
      ctx.lineTo(0, y + size);
      ctx.stroke();
    }
    const tex = this.toTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  },
  ceiling() {
    const size = 512;
    const c = this.makeCanvas(size);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#e6dcb0";
    ctx.fillRect(0, 0, size, size);
    const img = ctx.getImageData(0, 0, size, size);
    const d = img.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = this.fbm(x * 0.04, y * 0.04);
        const i = (y * size + x) * 4;
        d[i] = Math.min(255, d[i] + (n - 0.5) * 16);
        d[i + 1] = Math.min(255, d[i + 1] + (n - 0.5) * 14);
        d[i + 2] = Math.min(255, d[i + 2] + (n - 0.5) * 8);
      }
    }
    ctx.putImageData(img, 0, 0);
    ctx.strokeStyle = "rgba(150,138,80,0.55)";
    ctx.lineWidth = 3;
    const cell = size / 2;
    for (let i = 0; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cell, 0);
      ctx.lineTo(i * cell, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * cell);
      ctx.lineTo(size, i * cell);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(120,110,60,0.28)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath();
      ctx.moveTo(i * (size / 4), 0);
      ctx.lineTo(i * (size / 4), size);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(90,80,40,0.35)";
    for (let gy = 0; gy < 2; gy++) {
      for (let gx = 0; gx < 2; gx++) {
        ctx.fillRect(gx * cell + 6, gy * cell + 6, 4, 4);
        ctx.fillRect(gx * cell + cell - 10, gy * cell + 6, 4, 4);
        ctx.fillRect(gx * cell + 6, gy * cell + cell - 10, 4, 4);
        ctx.fillRect(gx * cell + cell - 10, gy * cell + cell - 10, 4, 4);
      }
    }
    return this.toTexture(c);
  }
};

function applyBoxUVs(geometry, w, h, d, tilesPerMeter) {
  const uv = geometry.attributes.uv;
  const t = tilesPerMeter || 0.5;
  const faces = [
    [d * t, h * t],
    [d * t, h * t],
    [w * t, d * t],
    [w * t, d * t],
    [w * t, h * t],
    [w * t, h * t]
  ];
  for (let f = 0; f < 6; f++) {
    const i = f * 4;
    const us = faces[f][0], vs = faces[f][1];
    uv.setXY(i + 0, 0, vs);
    uv.setXY(i + 1, us, vs);
    uv.setXY(i + 2, 0, 0);
    uv.setXY(i + 3, us, 0);
  }
  uv.needsUpdate = true;
  return geometry;
}

function makeWorldBox(w, h, d, tilesPerMeter) {
  const g = new THREE.BoxGeometry(w, h, d);
  return applyBoxUVs(g, w, h, d, tilesPerMeter);
}

function initAssets() {
  TextureFactory.loader = new THREE.TextureLoader();
  Geometries.box = new THREE.BoxGeometry(1, 1, 1);
  Geometries.lightPanel = new THREE.PlaneGeometry(1.55, 0.42);
  Geometries.lightHousing = new THREE.BoxGeometry(1.72, 0.08, 0.58);
  Geometries.floorTile = new THREE.PlaneGeometry(CONFIG.tile, CONFIG.tile);
  Geometries.column = makeWorldBox(0.55, CONFIG.wallH, 0.55, 0.55);
  Geometries.beam = new THREE.BoxGeometry(1, 0.1, 0.18);

  const wallMap = TextureFactory.fromConfigOrCanvas("wall", () => TextureFactory.wallpaper(1.2, 0));
  const wallAltMap = TextureFactory.fromConfigOrCanvas("wallAlt", () => TextureFactory.wallpaper(4.8, -8));
  const carpetMap = TextureFactory.fromConfigOrCanvas("carpet", () => TextureFactory.carpet());
  const ceilingMap = TextureFactory.fromConfigOrCanvas("ceiling", () => TextureFactory.ceiling());

  Materials.wall = new THREE.MeshStandardMaterial({
    map: wallMap, roughness: 0.86, metalness: 0.02, color: 0xffffff
  });
  Materials.wallAlt = new THREE.MeshStandardMaterial({
    map: wallAltMap, roughness: 0.88, metalness: 0.02, color: 0xf6eec8
  });
  Materials.wallTrim = new THREE.MeshStandardMaterial({
    color: 0xbba24a, roughness: 0.72, metalness: 0.04
  });
  Materials.carpet = new THREE.MeshStandardMaterial({
    map: carpetMap, roughness: 0.97, metalness: 0.0, color: 0xffffff
  });
  Materials.carpetDark = new THREE.MeshStandardMaterial({
    map: carpetMap, roughness: 0.97, metalness: 0.0, color: 0xb89a48
  });
  Materials.ceiling = new THREE.MeshStandardMaterial({
    map: ceilingMap, roughness: 0.9, metalness: 0.0, color: 0xffffff
  });
  Materials.column = new THREE.MeshStandardMaterial({
    map: wallMap, roughness: 0.84, metalness: 0.02, color: 0xf0e4a8
  });
  Materials.light = new THREE.MeshStandardMaterial({
    color: 0xfff6d8, emissive: 0xfff1c2, emissiveIntensity: 1.35, roughness: 0.4, metalness: 0
  });
  Materials.lightHousing = new THREE.MeshStandardMaterial({
    color: 0xcfc8a0, roughness: 0.55, metalness: 0.08
  });
  Materials.checkpoint = new THREE.MeshStandardMaterial({
    color: 0x8fd18f, emissive: 0x1a4a1a, roughness: 0.6, metalness: 0.05
  });
  Materials.exit = new THREE.MeshStandardMaterial({
    color: 0x8fa8d8, emissive: 0x1a2a48, roughness: 0.6, metalness: 0.05
  });
  Materials.frame = new THREE.MeshStandardMaterial({
    color: 0xb8a040, roughness: 0.7, metalness: 0.05
  });
  Materials.beam = new THREE.MeshStandardMaterial({
    color: 0xcfc28a, roughness: 0.78, metalness: 0.04
  });
  const concMap = TextureFactory.concrete();
  Materials.concrete = new THREE.MeshStandardMaterial({
    map: concMap, roughness: 0.90, metalness: 0.02, color: 0xc2c0ba
  });
  Materials.concreteDark = new THREE.MeshStandardMaterial({
    map: concMap, roughness: 0.93, metalness: 0.01, color: 0x8f8d87
  });
  Materials.nosing = new THREE.MeshStandardMaterial({
    color: 0xc9b23a, roughness: 0.55, metalness: 0.08, emissive: 0x2a2208, emissiveIntensity: 0.12
  });
  const meshMap = TextureFactory.chainlink();
  meshMap.repeat.set(6, 4);
  Materials.chainlink = new THREE.MeshStandardMaterial({
    map: meshMap, transparent: true, roughness: 0.7, metalness: 0.15,
    color: 0x2a2a28, side: THREE.DoubleSide, depthWrite: false
  });
  Materials.tube = new THREE.MeshStandardMaterial({
    color: 0xf4f0d8, emissive: 0xfff4c8, emissiveIntensity: 1.6, roughness: 0.25
  });
}

