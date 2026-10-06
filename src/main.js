import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Audio } from './audio.js';

const TL = window.__TL, S = TL.scenes, CUES = TL.cues, TOTAL = TL.total;
const cue = (scene, i) => CUES.filter(c => c.scene === scene)[i];
// instante aproximado en que se pronuncia una palabra dentro de una frase (reparto proporcional por caracteres)
const at = (scene, i, word) => { const c = cue(scene, i); const k = c.text.indexOf(word); return c.s + (c.e - c.s) * Math.max(0, k) / c.text.length; };
const B = (x, y, z) => new THREE.Vector3(x, z, -y);          // Blender (x este, y norte, z arriba) -> three
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

// ------------------------------------------------------------------ RENDERER / ESCENA
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.localClippingEnabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.3, 6000);
scene.fog = new THREE.Fog(0x000000, 200, 2600);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.35, 0.6, 0.86); composer.addPass(bloom);
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, fade: { value: 0 }, time: { value: 0 }, warm: { value: 0 }, flash: { value: 0 }, sepia: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float fade,time,warm,flash,sepia; varying vec2 vUv;
  float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233))+time*7.)*43758.5453);}
  void main(){ vec4 c=texture2D(tDiffuse,vUv); vec3 col=c.rgb;
    col*= mix(vec3(1.),vec3(1.06,1.,.9),warm);
    float l=dot(col,vec3(.299,.587,.114)); col=mix(col, vec3(l)*vec3(1.1,.95,.75), sepia);
    vec2 q=vUv-.5; col*= 1.-dot(q,q)*1.1;
    col+= (h(vUv)-.5)*.035; col+=flash; col*=1.-fade; gl_FragColor=vec4(col,c.a);} `
});
composer.addPass(grade); composer.addPass(new OutputPass());

function resize() {
  const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); composer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// ------------------------------------------------------------------ CIELO Y LUCES
const skyU = { top: { value: new THREE.Color() }, bot: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3() }, sunCol: { value: new THREE.Color() }, stars: { value: 0 } };
const sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
  vertexShader: 'varying vec3 vP; void main(){ vP=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `uniform vec3 top,bot,sunCol,sunDir; uniform float stars; varying vec3 vP;
  float h(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
  void main(){ float y=clamp(vP.y,0.,1.); vec3 c=mix(bot,top,pow(y,.55));
    float s=max(dot(vP,normalize(sunDir)),0.); c+=sunCol*(pow(s,600.)*4.+pow(s,8.)*.25);
    vec3 g=floor(vP*400.); float st=step(.9985,h(g))*stars*smoothstep(0.,.3,vP.y); c+=st;
    gl_FragColor=vec4(c,1.);} `
}));
scene.add(sky);
const sun = new THREE.DirectionalLight(0xffffff, 2); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -130, right: 130, top: 130, bottom: -130, near: 10, far: 700 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x6b4a32, 0.6); scene.add(hemi);
const interiorLights = new THREE.Group(); scene.add(interiorLights);
[[33, 0, 6, 0xffc070, 70], [0, -14, 10, 0xffd9a0, 45], [-30, 0, 12, 0xffd0a0, 35], [50, -21, 16, 0xffe0b0, 40], [24, 6, 5, 0xffc890, 20]].forEach(([x, y, z, c, i]) => {
  const l = new THREE.PointLight(c, i, 60, 1.6); l.position.copy(B(x, y, z)); interiorLights.add(l);
});
const bellLight = new THREE.PointLight(0xffc68a, 0, 30, 1.5); scene.add(bellLight);
const bombLight = new THREE.PointLight(0xbcd0ff, 0, 160, 1.2); bombLight.position.set(10, 95, 40); scene.add(bombLight);

const ENV = {
  night: { top: 0x02050c, bot: 0x0c1626, sun: [0.4, 0.8, -0.3], sc: 0x8aa4ff, si: 0.35, hemi: 0.18, fog: 0x0a1220, exp: 1.0, stars: 1 },
  dawn: { top: 0x2b4170, bot: 0xf0a46a, sun: [1, 0.12, 0.25], sc: 0xffb47a, si: 2.6, hemi: 0.5, fog: 0xd2a07e, exp: 1.0, stars: 0 },
  day: { top: 0x2f67b0, bot: 0xcfe2f4, sun: [0.35, 0.8, 0.55], sc: 0xfff4e6, si: 3.0, hemi: 0.75, fog: 0xbcd2e6, exp: 1.0, stars: 0 },
  golden: { top: 0x36578f, bot: 0xffc98a, sun: [-0.8, 0.22, 0.55], sc: 0xffc27a, si: 3.0, hemi: 0.55, fog: 0xe6b88e, exp: 1.0, stars: 0 },
  dusk: { top: 0x161d3c, bot: 0xc0607a, sun: [-1, 0.06, 0.3], sc: 0xff8a5a, si: 1.6, hemi: 0.35, fog: 0x6b4a64, exp: 1.0, stars: 0.4 },
};
const tmpA = new THREE.Color(), tmpB = new THREE.Color();
function setEnv(a, b, k) {
  const A = ENV[a], Bb = ENV[b];
  const mixc = (x, y) => tmpA.set(x).lerp(tmpB.set(y), k).clone();
  skyU.top.value.copy(mixc(A.top, Bb.top)); skyU.bot.value.copy(mixc(A.bot, Bb.bot));
  const d = new THREE.Vector3(...A.sun).lerp(new THREE.Vector3(...Bb.sun), k).normalize();
  skyU.sunDir.value.copy(d); skyU.sunCol.value.copy(mixc(A.sc, Bb.sc)); skyU.stars.value = A.stars + (Bb.stars - A.stars) * k;
  sun.color.copy(mixc(A.sc, Bb.sc)); sun.intensity = A.si + (Bb.si - A.si) * k;
  sun.position.copy(d.clone().multiplyScalar(400)); sun.target.position.set(0, 0, 0);
  hemi.intensity = A.hemi + (Bb.hemi - A.hemi) * k; scene.fog.color.copy(mixc(A.fog, Bb.fog));
}

// ------------------------------------------------------------------ TEXTURAS PROCEDURALES
function canvasTex(w, h, draw, rep = [1, 1]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...rep);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
// teja vidriada de las cúpulas (verde, amarillo, azul, blanco en zigzag/rombos, según fotografías)
const tileTex = canvasTex(256, 512, (g, w, h) => {
  const cols = ['#f4f1e6', '#1f7a4a', '#e8b821', '#2b5aa6', '#f4f1e6', '#e8b821', '#1f7a4a', '#2b5aa6'];
  g.fillStyle = '#f4f1e6'; g.fillRect(0, 0, w, h);
  const band = h / 16;
  for (let r = 0; r < 16; r++) for (let x = 0; x < w; x += 4) {
    for (let k = 0; k < 4; k++) {
      const yy = r * band + k * band / 4 + Math.abs(((x / w * 4) % 1) - 0.5) * band * 1.2;
      g.fillStyle = cols[(r + k) % cols.length]; g.fillRect(x, yy, 4, band / 4 + 1);
    }
  }
  for (let y = 0; y < h; y += 8) { g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(0, y, w, 1); }
}, [6, 1]);
const greenTex = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#2f6b52'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) { g.fillStyle = `rgba(${120 + Math.random() * 60},${200 + Math.random() * 40},160,.18)`; g.fillRect(x + ((y / 8) % 2) * 4, y, 7, 7); }
}, [8, 2]);
const leadTex = canvasTex(256, 64, (g, w, h) => {
  g.fillStyle = '#6d6a66'; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 16) { g.fillStyle = '#4a4744'; g.fillRect(x, 0, 2, h); }
  for (let y = 0; y < h; y += 6) for (let x = 0; x < w; x += 8) { g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(x + (y % 12 ? 4 : 0), y, 4, 3); }
}, [2, 3]);

// piedra/ladrillo: hiladas y variación según posición mundial
function stoneify(m, scale = 1) {
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp=(modelMatrix*vec4(transformed,1.)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vWp;
      float hh(vec2 p){return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5);} `)
      .replace('#include <color_fragment>', `#include <color_fragment>
      float row=floor(vWp.y*${(3.2 * scale).toFixed(2)}); float line=smoothstep(.0,.08,fract(vWp.y*${(3.2 * scale).toFixed(2)}));
      float n=hh(vec2(row, floor((vWp.x+vWp.z)*1.3+row*.5)));
      diffuseColor.rgb*= (.86+.16*n)*(.82+.18*line);
      diffuseColor.rgb*= .9+.1*smoothstep(0.,6.,vWp.y);`);
  };
  return m;
}

// ------------------------------------------------------------------ CARGA DEL MODELO (Blender -> glTF)
const groups = {}; const named = {};
const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 400);
const BAROQUE = /^(Body|Roof|Dome|Tower_|Bells_|Interior|Capilla|Retablo|Bombs$)/;
const fresco = new THREE.TextureLoader().load('data:image/jpeg;base64,' + window.__FRESCO); fresco.colorSpace = THREE.SRGBColorSpace;
const ghostMats = [];
function ghostMat(color) {
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { col: { value: new THREE.Color(color) }, op: { value: 0 }, time: { value: 0 } },
    vertexShader: 'varying vec3 vN,vV,vW; void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; vN=normalize(normalMatrix*normal); vec4 mv=viewMatrix*w; vV=-mv.xyz; gl_Position=projectionMatrix*mv; }',
    fragmentShader: `uniform vec3 col; uniform float op,time; varying vec3 vN,vV,vW;
      void main(){ float f=1.-abs(dot(normalize(vN),normalize(vV))); float scan=.55+.45*sin(vW.y*3.-time*4.);
      gl_FragColor=vec4(col*(.3+f*1.6)*scan*op, 1.);} `
  });
  ghostMats.push(m); return m;
}

async function loadModel() {
  const gltf = await new GLTFLoader().parseAsync(b64(window.__GLB).buffer, '');
  const root = gltf.scene;
  const list = []; root.traverse(o => { if (o.isMesh) list.push(o); });
  const matCache = {};
  for (const o of list) {
    const g = o.userData.grp || 'misc';
    if (!groups[g]) { groups[g] = new THREE.Group(); groups[g].name = g; scene.add(groups[g]); }
    named[o.name] = o;
    const wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3();
    o.updateWorldMatrix(true, false); o.matrixWorld.decompose(wp, wq, ws);
    groups[g].add(o); o.position.copy(wp); o.quaternion.copy(wq); o.scale.copy(ws);
    const mn = o.material.name; const key = mn + (BAROQUE.test(g) ? '_clip' : '');
    if (!matCache[key]) {
      let m = o.material.clone();
      if (/^Stone|Brick|Plaster|Floor|Alab/.test(mn)) stoneify(m, mn === 'Brick' ? 2 : 1);
      if (mn === 'Stone') m.color.set(0xd29c68);
      if (mn === 'StoneLight') m.color.set(0xe2b98a);
      if (mn === 'Tile') { m.map = tileTex; m.roughness = 0.25; m.metalness = 0.05; m.color.set(0xffffff); }
      if (mn === 'GreenTile') { m.map = greenTex; m.roughness = 0.3; }
      if (mn === 'Lead') { m.map = leadTex; m.color.set(0xc9c5bf); m.metalness = 0.4; m.roughness = 0.45; }
      if (mn === 'Roof') {
        m.color.set(0xb8805a);
        // óculos: la cubierta no se dibuja sobre las cúpulas (para verlas desde el interior)
        m.onBeforeCompile = sh => {
          sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp=(modelMatrix*vec4(transformed,1.)).xyz;');
          sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;\nuniform vec3 uD[11];').replace('void main() {', 'void main() {\n for(int i=0;i<11;i++){ if(length(vWp.xz-uD[i].xy)<uD[i].z) discard; }');
          sh.uniforms.uD = { value: DOMES.map(([x, y, r]) => new THREE.Vector3(x, -y, r * 1.02)) };
        };
      }
      if (mn === 'Opening') { m.color.set(0x110d0a); m.roughness = 1; }
      if (mn === 'Fresco') { m = new THREE.MeshBasicMaterial({ map: fresco, side: THREE.DoubleSide }); }
      if (/Plaster|Floor|Roof/.test(mn)) m.side = THREE.DoubleSide;
      if (mn === 'Gold') { m.emissive = new THREE.Color(0x553300); }
      if (BAROQUE.test(g)) m.clippingPlanes = [clipPlane];
      m.name = mn; matCache[key] = m;
    }
    o.material = matCache[key];
    o.castShadow = !/Interior|Capilla|Retablo|Bombs|Romanico|Gotico|TorreNueva/.test(g);
    o.receiveShadow = true;
  }
  // fresco de Goya: proyección planar desde abajo (fotografía real, dominio público)
  const rm = named['DomeInRM'];
  if (rm) {
    const p = rm.geometry.attributes.position, uv = rm.geometry.attributes.uv, c = B(50, -21, 0), R = 6.2;
    for (let i = 0; i < p.count; i++) uv.setXY(i, 0.5 + (p.getX(i) - c.x) / (2 * R) * 0.98, 0.5 - (p.getZ(i) - c.z) / (2 * R) * 0.98);
    uv.needsUpdate = true;
  }
  if (groups.Ceiling) groups.Ceiling.visible = false;
  // fantasmas (esquemas de templos anteriores, Torre Nueva)
  const gm = { Romanico: 0xffb070, Gotico: 0x7fd4ff, TorreNueva: 0xffa060 };
  for (const k in gm) if (groups[k]) {
    const m = ghostMat(gm[k]); groups[k].traverse(o => { if (o.isMesh) { o.material = m; o.castShadow = false; } });
    groups[k].visible = false; groups[k].userData.mat = m;
    groups[k].traverse(o => { if (o.isMesh) { const e = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 30), new THREE.LineBasicMaterial({ color: gm[k], transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); e.position.copy(o.position); e.quaternion.copy(o.quaternion); e.userData.edge = true; groups[k].add(e); } });
  }
  if (groups.BombsFall) groups.BombsFall.visible = false;
}

// ------------------------------------------------------------------ CIUDAD, PLAZA, EBRO (contexto aproximado)
function buildCity() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.MeshStandardMaterial({ color: 0x8a7560, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const plaza = new THREE.Mesh(new THREE.PlaneGeometry(560, 64), stoneify(new THREE.MeshStandardMaterial({ color: 0xcfc6b8, roughness: 0.9 })));
  plaza.rotation.x = -Math.PI / 2; plaza.position.copy(B(10, -68, 0.05)); plaza.receiveShadow = true; scene.add(plaza);
  // Ebro (al norte), con ondulación
  const waterU = { time: { value: 0 }, sky: { value: new THREE.Color() } };
  const water = new THREE.Mesh(new THREE.PlaneGeometry(4000, 120, 1, 1), new THREE.ShaderMaterial({
    uniforms: waterU, fog: false,
    vertexShader: 'varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }',
    fragmentShader: `uniform float time; uniform vec3 sky; varying vec3 vW;
      void main(){ float r=sin(vW.x*.08+time*.9)*sin(vW.z*.21-time*.7)+sin((vW.x+vW.z)*.37+time*1.3)*.5;
      vec3 deep=vec3(.05,.1,.11); vec3 v=normalize(cameraPosition-vW); float fr=pow(1.-max(v.y,0.),4.);
      vec3 c=mix(deep, sky*.8, .12+fr*.55)+r*.03+sky*pow(max(r,0.),6.)*.25; gl_FragColor=vec4(c,1.);} `
  }));
  water.rotation.x = -Math.PI / 2; water.position.copy(B(0, 125, 0.4)); scene.add(water);
  for (const yy of [65, 185]) { const bank = new THREE.Mesh(new THREE.BoxGeometry(4000, 3, 6), new THREE.MeshStandardMaterial({ color: 0x6e6252 })); bank.position.copy(B(0, yy, 1)); scene.add(bank); }
  // Puente de Piedra (esquemático, aguas abajo)
  const bridgeM = stoneify(new THREE.MeshStandardMaterial({ color: 0xb79a7a }));
  const deck = new THREE.Mesh(new THREE.BoxGeometry(14, 3, 130), bridgeM); deck.position.copy(B(300, 125, 9)); deck.castShadow = true; scene.add(deck);
  for (let i = 0; i < 6; i++) { const p = new THREE.Mesh(new THREE.BoxGeometry(14, 9, 6), bridgeM); p.position.copy(B(300, 70 + i * 22, 4)); scene.add(p); }
  // edificios del entorno (Ayuntamiento, Lonja, La Seo) — volúmenes aproximados
  const bm = stoneify(new THREE.MeshStandardMaterial({ color: 0xc9a27e, roughness: 0.95 }));
  [[125, 0, 50, 56, 20], [185, -10, 34, 40, 18], [290, -10, 70, 60, 24]].forEach(([x, y, sx, sy, h]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sy), bm); m.position.copy(B(x, y, h / 2)); m.castShadow = m.receiveShadow = true; scene.add(m);
  });
  const seoT = new THREE.Mesh(new THREE.BoxGeometry(10, 60, 10), bm); seoT.position.copy(B(262, -36, 30)); seoT.castShadow = true; scene.add(seoT);
  // trama urbana procedural (no reproduce manzanas reales)
  const N = 2600, box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
  const roof = new THREE.ConeGeometry(0.75, 0.35, 4, 1); roof.rotateY(Math.PI / 4); roof.translate(0, 0.175, 0);
  const im = new THREE.InstancedMesh(box, stoneify(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 })), N);
  const ir = new THREE.InstancedMesh(roof, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), N);
  const d = new THREE.Object3D(); let n = 0; let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const cols = [0xd8c2a0, 0xc9a882, 0xe3d4ba, 0xb98d6a, 0xd6b58e];
  const rcol = [0xa0583a, 0x9a6046, 0xb36a48, 0x8c5a44];
  while (n < N) {
    const x = (rnd() - 0.5) * 2400, y = (rnd() - 0.5) * 2400;
    if (y > 50 && y < 200) continue;                             // río
    if (x > -320 && x < 340 && y > -110 && y < 50) continue;     // plaza y basílica
    if (Math.hypot(x + 260, y + 330) < 22) continue;             // emplazamiento Torre Nueva
    const sx = 14 + rnd() * 26, sy = 12 + rnd() * 24, h = 10 + rnd() * 16 + (Math.hypot(x, y) > 700 ? rnd() * 18 : 0);
    const rot = (rnd() < 0.5 ? 0 : 0.08) + (rnd() - 0.5) * 0.06;
    d.position.copy(B(x, y, 0)); d.rotation.set(0, rot, 0); d.scale.set(sx, h, sy); d.updateMatrix(); im.setMatrixAt(n, d.matrix);
    im.setColorAt(n, new THREE.Color(cols[n % cols.length]));
    d.position.y = h; d.scale.set(sx * 1.02, Math.min(sx, sy) * 0.9, sy * 1.02); d.updateMatrix(); ir.setMatrixAt(n, d.matrix);
    ir.setColorAt(n, new THREE.Color(rcol[n % rcol.length])); n++;
  }
  im.castShadow = im.receiveShadow = true; ir.receiveShadow = true; scene.add(im, ir);
  return waterU;
}

// ------------------------------------------------------------------ INTERIOR: techo con óculos bajo las cúpulas
const DOMES = [[0, 0, 11.5 * 0.96], [33, 0, 8 * 0.97], [-33, 0, 8 * 0.97]];
for (const x of [-50, -18, 18, 50]) for (const y of [-21, 21]) DOMES.push([x, y, 6.2 * 0.97]);
function buildCeiling() {
  const sh = new THREE.Shape(); sh.moveTo(-63.5, -32); sh.lineTo(63.5, -32); sh.lineTo(63.5, 32); sh.lineTo(-63.5, 32); sh.lineTo(-63.5, -32);
  for (const [x, y, r] of DOMES) { const p = new THREE.Path(); p.absarc(x, y, r, 0, Math.PI * 2, true); sh.holes.push(p); }
  const g = new THREE.ShapeGeometry(sh, 32); g.rotateX(-Math.PI / 2);
  const m = stoneify(new THREE.MeshStandardMaterial({ color: 0xe9dcc6, side: THREE.DoubleSide, roughness: 0.9, clippingPlanes: [clipPlane] }));
  const c = new THREE.Mesh(g, m); c.position.y = 22.6; c.receiveShadow = true; c.castShadow = true; scene.add(c);
  for (const [x, y, r] of DOMES) if (r < 9) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 6.6, 40, 1, true), m); w.position.copy(B(x, y, 22.6 + 3.3)); scene.add(w);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.25, 6, 48), new THREE.MeshStandardMaterial({ color: 0xd6b26a, metalness: 0.6, roughness: 0.4, clippingPlanes: [clipPlane] }));
    ring.rotation.x = Math.PI / 2; ring.position.copy(B(x, y, 22.4)); scene.add(ring);
  }
  // haces de luz (aditivos) desde las ventanas del sur
  const shaftM = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { op: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'uniform float op; varying vec2 vUv; void main(){ float a=(1.-vUv.y)*smoothstep(0.,.3,vUv.x)*smoothstep(1.,.7,vUv.x); gl_FragColor=vec4(vec3(1.,.85,.6)*a*op*.16,1.);} '
  });
  const shafts = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(3, 26), shaftM);
    s.position.copy(B(-52 + i * 13.2, -22, 10)); s.rotation.set(0.55, 0, 0); shafts.add(s);
  }
  scene.add(shafts); return shaftM;
}

// ------------------------------------------------------------------ PARTÍCULAS
function particles(n, spread, color, size) {
  const g = new THREE.BufferGeometry(); const p = new Float32Array(n * 3); const v = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { p.set([(Math.random() - .5) * spread[0], Math.random() * spread[1], (Math.random() - .5) * spread[2]], i * 3); v.set([Math.random() - .5, Math.random(), Math.random() - .5], i * 3); }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.userData.v = v; g.userData.p0 = p.slice();
  const m = new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; scene.add(pts); return pts;
}
const dust = particles(900, [120, 22, 60], 0xffe2b0, 0.09); dust.position.copy(B(0, 0, 1));
const fire = particles(1600, [40, 30, 16], 0xff7a2a, 0.9); fire.position.copy(B(20, 0, 0));
const burst = particles(1500, [16, 4, 16], 0xc8a888, 1.6);

// ondas sonoras de las campanas (anillos sobre la ciudad)
const waves = [];
const waveM = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { op: { value: 0 }, col: { value: new THREE.Color(0xffd8a0) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: 'uniform float op; uniform vec3 col; varying vec2 vUv; void main(){ float a=sin(vUv.x*3.14159); gl_FragColor=vec4(col*a*op,1.);} '
});
function spawnWave(t, pos, strength, col = 0xffd8a0) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 128, 1), waveM()); m.material.uniforms.col.value.set(col);
  m.rotation.x = -Math.PI / 2; m.position.copy(pos); m.position.y = 2; m.visible = false; scene.add(m);
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), waveM()); sphere.material.uniforms.col.value.set(col);
  sphere.position.copy(pos); sphere.visible = false; scene.add(sphere);
  waves.push({ t, m, sphere, strength });
}

// ------------------------------------------------------------------ SALA DEL CAMPANERO (escalera de la torre) — recreación
function buildStair() {
  const g = new THREE.Group(); g.position.set(2000, 0, 0); scene.add(g);
  const wallTex = canvasTex(1024, 512, (c, w, h) => {
    c.fillStyle = '#8c7458'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) { c.fillStyle = `rgba(${60 + Math.random() * 60},${45 + Math.random() * 40},${30 + Math.random() * 30},.25)`; c.fillRect(Math.random() * w, Math.random() * h, 3 + Math.random() * 8, 2 + Math.random() * 5); }
    c.font = 'bold 118px Georgia, serif'; c.fillStyle = 'rgba(40,22,14,.82)'; c.textAlign = 'center';
    c.save(); c.translate(w / 2, h * 0.42); c.rotate(-0.03); c.fillText('José Azuara', 0, 0); c.restore();
    c.save(); c.translate(w / 2 + 20, h * 0.72); c.rotate(-0.02); c.fillText('Campanero', 0, 0); c.restore();
  });
  wallTex.repeat.set(1, 1);
  const room = new THREE.Mesh(new THREE.BoxGeometry(5, 9, 12), new THREE.MeshStandardMaterial({ color: 0x9a8064, side: THREE.BackSide, roughness: 1 }));
  room.position.y = 4.5; g.add(room);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 2.3), new THREE.MeshStandardMaterial({ map: wallTex, roughness: 1 }));
  wall.position.set(0, 3.2, -5.95); g.add(wall);
  for (let i = 0; i < 10; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.24 * (i + 1), 0.55), new THREE.MeshStandardMaterial({ color: 0x7a6650 })); s.position.set(1.65, 0.12 * (i + 1), 2 - i * 0.55); g.add(s); }
  const lamp = new THREE.SpotLight(0xffd29a, 0, 20, 0.75, 0.9, 1.0); lamp.position.set(0.5, 2.2, 3); lamp.target.position.set(0, 3.2, -6); g.add(lamp, lamp.target);
  return { g, lamp };
}

// ------------------------------------------------------------------ CÁMARA: planos
// cada plano: [t0, t1, [posiciones Blender], [miradas Blender], fov, easing]
let SHOTS = [];
function shot(t0, t1, P, L, fov = 42, e = ease) {
  SHOTS.push({ t0, t1, pc: new THREE.CatmullRomCurve3(P.map(p => B(...p)), false, 'centripetal'), lc: new THREE.CatmullRomCurve3(L.map(p => B(...p)), false, 'centripetal'), fov, e });
}
function buildShots() {
  SHOTS = [];
  const b1 = cue('bells', 1).s, b2 = cue('bells', 2).s, pil = S.sitios - 7.4;
  const c1 = cue('capilla', 1).s, c3 = cue('capilla', 3).s;
  const t1 = cue('sitios', 1).s, t2 = cue('sitios', 2).s;
  const k1 = cue('bombs', 1).s, k3 = cue('bombs', 3).s, a1 = cue('azuara', 1).s;
  shot(0, S.ebro, [[460, 140, 9], [380, 125, 12]], [[0, 10, 40], [0, 0, 42]], 38, t => t);
  shot(S.ebro, S.rewind, [[380, 125, 12], [240, 112, 10], [120, 105, 24], [10, 140, 52]], [[0, 0, 42], [0, 0, 38], [-20, 0, 40], [0, -10, 30]], 40);
  shot(S.rewind, S.capilla, [[10, 140, 52], [-170, 170, 120], [-240, -40, 150], [-120, -230, 140], [110, -240, 120]], [[0, -10, 30], [0, 0, 20], [0, 0, 20], [0, 0, 20], [10, 0, 25]], 44, t => t);
  shot(S.capilla, c1, [[110, -240, 120], [40, -120, 12], [30, -46, 6], [30, -31, 5.5], [32.5, -17, 4.5], [33, -9.5, 3.6]], [[10, 0, 25], [30, 0, 10], [30, 0, 7], [32, 0, 6], [33, 0, 6], [33, 0, 7]], 48);
  shot(c1, c3, [[33, -9.5, 3.6], [44, -17, 4.5], [48.8, -19.6, 7]], [[33, 0, 7], [50, -21, 25], [50.15, -21.2, 40]], 60);
  shot(c3, S.bells - 1.2, [[10, -24, 5], [4, -22, 5], [0, -21, 6.5]], [[3, -9, 8], [0, -9, 9], [0, -9, 10]], 50);
  shot(S.bells - 1.2, b1, [[-90, -78, 4], [-84, -60, 30], [-76, -48, 52]], [[-64, -32.5, 20], [-64, -32.5, 40], [-64, -32.5, 58]], 44);
  shot(b1, b2, [[-76, -48, 52], [-68, -40, 58.5], [-62.5, -35, 58.5]], [[-64, -32.5, 58], [-64, -32.5, 57], [-64.5, -32, 56.5]], 52);
  shot(b2, pil, [[-62.5, -35, 58.5], [-61.6, -34.6, 57.2]], [[-64.5, -32, 56.5], [-64, -32.5, 56.2]], 50);
  shot(pil, S.sitios, [[-61.6, -34.6, 57.2], [-62, -35, 57.4], [-100, -110, 95], [-160, -260, 170]], [[-64, -32.5, 56.2], [-64, -32.5, 56.5], [-64, -32.5, 40], [-40, -20, 20]], 50, t => t < .3 ? t * .3 / .3 * .35 : .35 + ease((t - .3) / .7) * .65);
  shot(S.sitios, t1, [[-160, -260, 170], [40, -80, 75], [67.5, -36.8, 56]], [[-40, -20, 20], [64, -32.5, 58], [64, -32.5, 55.6]], 50);
  shot(t1, t2 + 1.5, [[67.5, -36.8, 56], [110, -170, 110], [80, -300, 100]], [[64, -32.5, 55.6], [-60, -180, 40], [-140, -250, 40]], 46);
  shot(t2 + 1.5, S.bombs, [[80, -300, 100], [120, -120, 60], [100, -70, 40]], [[-140, -250, 40], [64, -32.5, 58], [0, 30, 30]], 46);
  shot(S.bombs, k3, [[90, -230, 120], [40, -150, 80], [12, -95, 55]], [[10, 0, 40], [5, 0, 50], [2, 0, 48]], 44, t => t);
  shot(k3, S.azuara, [[20, 2, 3.2], [22.2, 4.4, 3.4]], [[25.3, 6.8, 3.5], [25.4, 7.0, 3.6]], 40, t => t);
  shot(S.azuara, a1, [[2000, -4.6, 1.9], [2000, -3.2, 3.0]], [[2000, 6, 2.6], [2000, 6, 3.2]], 52, t => t);   // (coords de la sala: x desplazada)
  shot(a1, TOTAL + 1, [[-64, -32.5, 59], [-90, -70, 75], [-220, -260, 140], [-300, -380, 160]], [[-64, -32.5, 60], [-64, -32.5, 58], [0, 0, 30], [0, 0, 30]], 48, t => ease(t));
}

// ------------------------------------------------------------------ UI: subtítulos y rótulos
const subEl = document.getElementById('sub'), cardsEl = document.getElementById('cards');
function splitCue(c) {
  // trocea frases largas en bloques legibles (≤ ~95 caracteres), repartiendo el tiempo
  const parts = []; let cur = '';
  for (const w of c.text.split(/(?<=[.:?!;])\s+|(?<=,)\s+/)) { if ((cur + ' ' + w).trim().length > 95 && cur) { parts.push(cur.trim()); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) parts.push(cur);
  const tot = c.text.length; let acc = 0;
  return parts.map(p => { const s = c.s + (c.e - c.s) * acc / tot; acc += p.length + 1; return { s, e: c.s + (c.e - c.s) * acc / tot, text: p }; });
}
const SUBS = CUES.flatMap(splitCue);
const CARDS = [];
function card(t0, t1, html, cls = '') { const el = document.createElement('div'); el.className = 'card ' + cls; el.innerHTML = html; cardsEl.appendChild(el); CARDS.push({ t0, t1, el }); }
function buildCards() {
  card(0.8, S.ebro - 0.3, '<div class="title">EL PILAR</div><div class="subtitle">Memoria de piedra y bronce</div>', 'center');
  card(cue('ebro', 0).s + 1.2, cue('ebro', 1).s, '<div class="k">ZARAGOZA · ORILLA DEL EBRO</div><div class="big">1681 → 1961</div><div class="m">130 × 67 m · 4 torres · 11 cúpulas</div>');
  card(cue('ebro', 1).s + 0.3, S.rewind, '<div class="tag">TRADICIÓN</div><div class="big">2 de enero del año 40</div><div class="m">La Virgen se aparece al apóstol Santiago<br>y deja una columna de jaspe</div>');
  const r1 = cue('rewind', 1);
  card(r1.s + 0.2, at('rewind', 1, 'La de la plaza'), '<div class="big">1961</div><div class="m">Torres del lado del río<br>(obra financiada por Francisco Urzaiz y Leonor Sala)</div>');
  card(at('rewind', 1, 'La de la plaza'), r1.e + 0.3, '<div class="big">1907</div><div class="m">Torre junto al Ayuntamiento<br>(Ricardo Magdalena · Fernando de Yarza)</div>');
  card(cue('rewind', 2).s, cue('rewind', 3).s, '<div class="big">1681</div><div class="m">Comienza el templo barroco<br>Trazas: Felipe Sánchez · revisión: Francisco Herrera el Mozo</div>');
  card(cue('rewind', 3).s, at('rewind', 3, 'Y antes'), '<div class="big">h. 1515</div><div class="m">Templo gótico-mudéjar</div>');
  card(at('rewind', 3, 'Y antes'), cue('rewind', 3).e + 0.6, '<div class="big">1118 · 1434</div><div class="m">Templo románico tras la conquista de Alfonso I<br>destruido por un incendio en 1434</div>');
  card(at('rewind', 3, 'gótico'), cue('rewind', 3).e + 0.6, 'Esquema ilustrativo. La forma exacta de los templos anteriores no se conoce.', 'disclaim');
  card(cue('rewind', 3).e + 0.7, S.capilla, '<div class="big" id="yearRoll">1515</div>', 'center');
  card(cue('capilla', 0).s + 0.5, c(1), '<div class="k">SANTA CAPILLA</div><div class="big">1750 – 1765</div><div class="m">Ventura Rodríguez · templete oval que guarda la columna</div>');
  card(c(1) + 0.4, c(3), '<div class="k">CÚPULA «REGINA MARTYRUM»</div><div class="big">1780 – 1781</div><div class="m">Francisco de Goya · terminada el 28 de mayo de 1781</div>');
  card(c(1) + 1.5, c(3), 'Fotografía real del fresco (Wikimedia Commons, dominio público) proyectada sobre la reconstrucción', 'disclaim');
  card(c(3) + 0.3, S.bells, '<div class="k">RETABLO MAYOR</div><div class="big">1509 – 1518</div><div class="m">Damián Forment · alabastro</div>');
  card(S.capilla + 3, S.bells, 'Interior: reconstrucción 3D esquemática basada en documentación disponible', 'disclaim');
  card(cue('bells', 1).s, cue('bells', 2).s, `<div class="k">INVENTARIO DE CAMPANAS</div><div class="cols">
   <div><b>Torre alta de la plaza · 9</b><br>Santa Ana · 1884<br>Campana del reloj · 1764 · Lester &amp; Pack (Londres)<br>La Santiaga · 1771 / 1804 *<br>Santa Isabel · 1971<br>Juana Paula · 1983<br>La Braulia · 1783<br>La Indalecia · 1794<br>Petra Paula · 1971<br><b>La Pilara · 1866</b></div>
   <div><b>Torre baja de la plaza · 6</b><br><b>Campana de los Sitios · 1711 *</b><br>Cuartos de la Torre Nueva · 1508 *<br>Carillón de Correos · 4 · 1940<br><br><b>Trascoro · 1</b><br>Campana de señales · h. 1900</div></div>
   <div class="m small">* La propia ficha da fechas distintas en su texto (1771; 1715 «por verificar»; 1558 «no verificado»).<br>Fuente: Campaners de la Catedral de València (F. Llop i Bayo)</div>`, 'wide');
  card(cue('bells', 2).s + 0.2, S.sitios - 0.5, '<div class="k">CAMPANA</div><div class="big">LA PILARA</div><div class="m">1866 · Andrés de Argos y Eugenio de Zuvieta<br>Ø 157 cm · 2.170 kg</div>');
  card(S.sitios - 6.6, S.sitios - 1, '<div class="tag">BANDEO</div><div class="m">Volteo completo de la campana mayor, reservado a las grandes fiestas</div>');
  card(cue('sitios', 0).s + 2.5, t(1), '<div class="k">CAMPANA</div><div class="big">DE LOS SITIOS</div><div class="m">1711 · Andrés de Asín · Ø 220 cm · 6.165 kg<br>Antes llamada «el Relox»</div>');
  card(t(1) + 1.2, t(2), '<div class="k">TORRE NUEVA · 1504 – 1892</div><div class="m">Torre mudéjar del reloj municipal, inclinada<br>Esquema ilustrativo (no a escala exacta)</div>');
  card(t(2) + 0.2, S.bombs - 0.5, '<div class="big">1892</div><div class="m">Derribo de la Torre Nueva · sus campanas pasan al Pilar</div>');
  card(cue('bombs', 0).s + 0.3, k(1), '<div class="big">3 · VIII · 1936</div><div class="m">Madrugada</div>');
  card(k(1) + 0.3, k(2), '<div class="big">3 o 4</div><div class="m">bombas, según las fuentes</div>');
  card(at('bombs', 1, 'Ninguna'), k(2) + 0.2, '<div class="big">NINGUNA EXPLOTÓ</div>', 'center');
  card(k(2), k(3), '<div class="cols"><div><span class="tag">TRADICIÓN</span><br>Milagro</div><div><span class="tag alt">INVESTIGACIÓN</span><br>Fallo de las espoletas<br>o sabotaje (VSCW)</div></div>', 'wide');
  card(k(3) + 0.2, S.azuara, '<div class="k">EXPUESTAS JUNTO A LA SANTA CAPILLA</div><div class="m">Hispana A-6 de 50 kg, según VSCW. Su autenticidad ha sido cuestionada.</div>');
  card(S.azuara + 0.5, cue('azuara', 1).s, 'Recreación. Inscripción documentada por Campaners de la Catedral de València; la letra original no se reproduce.', 'disclaim');
  card(S.outro + 1, TOTAL - 1.0, '<div class="title">EL PILAR</div><div class="subtitle">Memoria de piedra y bronce</div><div class="m small" style="margin-top:2vh">Reconstrucción 3D basada en documentación disponible · Fuentes al final</div>', 'center');
  function c(i) { return cue('capilla', i).s; } function t(i) { return cue('sitios', i).s; } function k(i) { return cue('bombs', i).s; }
}

// ------------------------------------------------------------------ BUCLE PRINCIPAL
let audio, t0 = null, waterU, shaftM, stair, playing = false;
const camShake = new THREE.Vector3();
function update(t) {
  // planos de cámara
  let sh = SHOTS.find(s => t >= s.t0 && t < s.t1) || SHOTS[SHOTS.length - 1];
  const u = sh.e(clamp((t - sh.t0) / (sh.t1 - sh.t0)));
  camera.position.copy(sh.pc.getPoint(u)); const look = sh.lc.getPoint(u);
  camera.fov = sh.fov; camera.updateProjectionMatrix();
  camera.position.add(camShake); camera.lookAt(look);

  // ambiente
  const E = [[0, 'night', 'dawn', 0, S.ebro], [S.ebro, 'dawn', 'day', S.rewind - 2, S.rewind + 4], [S.capilla, 'day', 'day', 0, 1], [S.bells - 2, 'day', 'golden', S.bells - 2, S.bells + 2],
    [S.sitios, 'golden', 'dusk', S.sitios, S.sitios + 8], [S.bombs - 2, 'dusk', 'night', S.bombs - 2, S.bombs + 1], [S.azuara + 3, 'night', 'dawn', cue('azuara', 1).s - 1, cue('azuara', 1).s + 4]];
  let env = E[0]; for (const e of E) if (t >= e[0]) env = e;
  setEnv(env[1], env[2], sm(env[3], env[4], t));
  const inside = camera.position.y < 22 && Math.abs(camera.position.x) < 64 && Math.abs(camera.position.z) < 33;
  interiorLights.visible = inside || (t > cue('bombs', 3).s - 0.5 && t < S.azuara);
  shaftM.uniforms.op.value = inside ? 1 : 0; dust.material.opacity = inside ? 0.7 : 0;
  hemi.intensity *= inside ? 0.6 : 1;
  grade.uniforms.warm.value = inside ? 1 : 0.3;

  // fundido a negro: inicio, cortes, final
  let fade = 1 - sm(1.5, 4.5, t);
  for (const cut of [cue('bombs', 3).s, S.azuara, cue('azuara', 1).s]) fade = Math.max(fade, 1 - Math.min(1, Math.abs(t - cut) / 0.45));
  fade = Math.max(fade, sm(TOTAL - 2.5, TOTAL - 0.2, t));
  grade.uniforms.fade.value = fade; grade.uniforms.time.value = t;
  grade.uniforms.sepia.value = sm(cue('rewind', 3).s - 1, cue('rewind', 3).s + 1, t) * (1 - sm(cue('rewind', 3).e + 0.6, cue('rewind', 3).e + 3, t)) * 0.7;

  // VIAJE EN EL TIEMPO
  const r1 = cue('rewind', 1), r3 = cue('rewind', 3);
  const sinkRiver = sm(r1.s + 0.4, r1.s + 3.4, t), sinkPlaza = sm(at('rewind', 1, 'La de la plaza'), at('rewind', 1, 'La de la plaza') + 3, t);
  const rebuild = sm(r3.e + 0.7, S.capilla - 0.9, t);
  const baroqueGone = sm(r3.s, r3.s + 2.6, t) * (1 - rebuild);
  const towersBack = sm(r3.e + 1.6, S.capilla - 0.6, t);
  const rs = (g, k) => { if (groups[g]) groups[g].position.y = -96 * k; };
  rs('Tower_NW', sinkRiver * (1 - towersBack)); rs('Tower_NE', sinkRiver * (1 - towersBack)); rs('Tower_SE', sinkPlaza * (1 - towersBack)); rs('Bells_SE', sinkPlaza * (1 - towersBack));
  clipPlane.constant = baroqueGone > 0 ? 100 * (1 - baroqueGone) - 1 : 400;
  const gotOn = sm(r3.s + 0.5, r3.s + 2, t) * (1 - sm(at('rewind', 3, 'Y antes'), at('rewind', 3, 'Y antes') + 1.5, t)) + sm(r3.e + 0.3, r3.e + 0.7, t) * (1 - sm(r3.e + 1.0, r3.e + 1.9, t));
  const romOn = sm(at('rewind', 3, 'Y antes'), at('rewind', 3, 'Y antes') + 1.4, t) * (1 - sm(r3.e + 0.2, r3.e + 0.9, t));
  const ghost = (g, k) => { if (!groups[g]) return; groups[g].visible = k > 0.01; groups[g].userData.mat.uniforms.op.value = k; groups[g].traverse(o => { if (o.userData.edge) o.material.opacity = k * 0.8; }); };
  ghost('Gotico', gotOn); ghost('Romanico', romOn);
  const fireK = sm(at('rewind', 3, 'incendio'), at('rewind', 3, 'incendio') + 0.5, t) * (1 - sm(r3.e + 0.2, r3.e + 1.2, t));
  fire.material.opacity = fireK;
  // contador de años al reconstruir
  const yr = document.getElementById('yearRoll');
  if (yr) { const k = sm(r3.e + 0.6, S.capilla - 0.5, t); const ys = [1515, 1681, 1765, 1872, 1907, 1961, 2026]; const y = Math.round(1515 + (2026 - 1515) * k); yr.textContent = k >= 1 ? 'HOY' : y; }
  // polvo de derrumbe
  const bk = Math.max(sinkRiver * (1 - sinkRiver) * 4, sinkPlaza * (1 - sinkPlaza) * 4);
  burst.material.opacity = bk * 0.5; burst.position.copy(sinkPlaza > 0.02 && sinkPlaza < 0.98 ? B(64, -32.5, 0) : B(0, 32.5, 0)); burst.scale.set(sinkPlaza > 0.02 && sinkPlaza < .98 ? 1 : 8, 1, 1);

  // CAMPANAS: bandeo de la Pilara
  const pil = named['Bell_Pilara'];
  const pk = clamp((t - (S.sitios - 6.8)) / 6.5);
  if (pil) pil.rotation.z = pk > 0 && pk < 1 ? -Math.PI * 2 * 2 * ease(pk) : 0;
  // balanceo suave del resto en el inventario
  for (const n of ['Bell_Indalecia', 'Bell_Braulia', 'Bell_PetraPaula', 'Bell_JuanaPaula']) if (named[n]) named[n].rotation.z = Math.sin(t * 1.7 + n.length) * 0.35 * sm(S.sitios - 6.5, S.sitios - 5.5, t) * (1 - sm(S.sitios + 2, S.sitios + 4, t));
  const sit = named['Bell_Sitios'];
  if (sit) sit.rotation.z = Math.sin((t - (S.bombs - 5)) * 2.4) * 0.05 * sm(S.bombs - 5, S.bombs - 4.5, t) * (1 - sm(S.bombs, S.bombs + 1, t));
  bellLight.position.copy(t < S.sitios + 3 ? B(-64, -34, 60) : B(64, -34, 60)); bellLight.intensity = (t > cue('bells', 1).s && t < S.sitios + 10) || (t > cue('sitios', 0).s && t < S.bombs) ? 40 : 0;

  // TORRE NUEVA: aparece, la campana viaja, desaparece
  const tn = groups.TorreNueva, tns = cue('sitios', 1).s, tnd = cue('sitios', 2).s;
  if (tn) {
    const on = sm(tns + 0.3, tns + 2.5, t) * (1 - sm(tnd + 2.2, tnd + 4.5, t));
    ghost('TorreNueva', on); tn.position.y = -80 * (1 - sm(tns, tns + 3, t));
    const c = B(-260, -330, 0); tn.rotation.set(0, 0, 0);
    tn.position.x = 0; tn.position.z = 0;
    // inclinación (esquemática) aplicada como rotación alrededor de su base
    tn.matrixAutoUpdate = false; const m = new THREE.Matrix4().makeTranslation(c.x, c.y + tn.position.y, c.z).multiply(new THREE.Matrix4().makeRotationZ(-0.045)).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
    tn.matrix.copy(m);
  }
  const fly = named['Bell_Sitios'];
  if (fly && groups.Bells_SE) {
    if (!fly.userData.home) fly.userData.home = fly.position.clone();
    const k = sm(tnd + 0.4, tnd + 3.6, t), from = B(-260, -330, 66), to = fly.userData.home;
    if (t > tns && t < tnd + 4) {
      const p = from.clone().lerp(to, k); p.y += Math.sin(k * Math.PI) * 60; fly.position.copy(t < tnd + 0.4 ? from : p);
    } else { fly.position.copy(to); }
  }

  // BOMBAS 1936
  const kb = cue('bombs', 1);
  const bf = groups.BombsFall;
  if (bf) {
    bf.visible = t > kb.s - 0.5 && t < cue('bombs', 3).s;
    if (bf.visible) {
      const k = 0.9 * ease(clamp((t - kb.s + 0.4) / (at('bombs', 1, 'Ninguna') - kb.s + 0.4)));
      const targets = [[10, -62, 1], [20, -5, 33], [-15, 10, 33], [0, 110, 1]];
      bf.children.forEach((o, i) => { const tg = targets[i % 4]; const p = B(tg[0], tg[1], tg[2] + (1 - k) * 95 + 3); o.position.copy(p); o.rotation.set(0, t * 0.6 + i, 0); o.visible = true; o.scale.setScalar(3.2); if (o.material && i === 3) { o.material.transparent = true; o.material.opacity = 0.3; } });
    }
  }
  grade.uniforms.flash.value = 0;
  bombLight.intensity = t > kb.s - 0.5 && t < cue('bombs', 3).s - 0.4 ? 650 : 0;

  // sala del campanero
  stair.lamp.intensity = t > S.azuara - 1 && t < cue('azuara', 1).s ? 9 * sm(S.azuara, S.azuara + 2.5, t) : 0;

  // ondas
  for (const w of waves) {
    const k = (t - w.t) / 9; const on = k > 0 && k < 1; w.m.visible = w.sphere.visible = on;
    if (on) { const r = 5 + k * 900 * w.strength; w.m.scale.set(r, r, r); w.m.material.uniforms.op.value = (1 - k) * 1.2; w.sphere.scale.setScalar(r * 0.6); w.sphere.material.uniforms.op.value = (1 - k) * 0.1; }
  }
  camShake.set(0, 0, 0);
  for (const w of waves) { const k = t - w.t; if (k > 0 && k < 1.2) camShake.set((Math.random() - .5), (Math.random() - .5), (Math.random() - .5)).multiplyScalar(0.08 * w.strength * (1 - k / 1.2)); }

  // partículas
  for (const P of [dust, fire, burst]) {
    if (P.material.opacity <= 0) continue;
    const a = P.geometry.attributes.position, v = P.geometry.userData.v, p0 = P.geometry.userData.p0;
    for (let i = 0; i < a.count; i++) {
      const sp = P === fire ? 8 : P === burst ? 6 : 0.15;
      let y = p0[i * 3 + 1] + ((t * sp * v[i * 3 + 1]) % 30);
      a.setXYZ(i, p0[i * 3] + Math.sin(t * .3 + i) * (P === dust ? .5 : 2) + v[i * 3] * (P === burst ? t % 3 * 6 : 0), P === dust ? p0[i * 3 + 1] + Math.sin(t * .2 + i) * .5 : y % 30, p0[i * 3 + 2] + v[i * 3 + 2] * (P === burst ? t % 3 * 6 : 0));
    }
    a.needsUpdate = true;
  }
  waterU.time.value = t; waterU.sky.value.copy(skyU.bot.value);
  for (const m of ghostMats) m.uniforms.time.value = t;

  // subtítulos y rótulos
  const sb = SUBS.find(s => t >= s.s - 0.05 && t < s.e + 0.35);
  const txt = sb ? sb.text : '';
  if (subEl.dataset.t !== txt) { subEl.dataset.t = txt; subEl.textContent = txt; subEl.classList.toggle('on', !!txt); }
  for (const c of CARDS) c.el.classList.toggle('on', t >= c.t0 && t < c.t1);
}

function loop() {
  if (!playing) return;
  const t = audio.time();
  update(t);
  composer.render();
  if (t >= TOTAL) { playing = false; document.getElementById('end').classList.add('on'); document.body.classList.remove('playing'); return; }
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------ ARRANQUE
(async function init() {
  const btn = document.getElementById('start');
  waterU = buildCity(); shaftM = buildCeiling(); stair = buildStair();
  await loadModel();
  // bombas que caen: 3 + 1 dudosa (las fuentes no coinciden)
  const bf = groups.BombsFall; const src = bf.children[0];
  for (let i = 0; i < 3; i++) { const c = src.clone(); c.material = src.material.clone(); bf.add(c); }
  bf.children.forEach(o => { o.material = o.material.clone(); o.material.clippingPlanes = []; o.material.color.set(0xb8c0ca); o.material.emissive = new THREE.Color(0x5a6270); const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.12, 14, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xcfe3ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })); tr.position.y = 8.6; o.add(tr); });
  buildShots(); buildCards();
  setEnv('dawn', 'dawn', 0); update(S.ebro + 6); composer.render();
  btn.disabled = false; btn.textContent = 'INICIAR DOCUMENTAL';
  window.__render = t => { update(t); composer.render(); };
  window.__dbg = { groups, named, clipPlane, THREE };   // utilidad de prueba (render de un instante)
  btn.onclick = async () => {
    document.getElementById('intro').classList.add('off'); document.body.classList.add('playing');
    try { await document.documentElement.requestFullscreen?.(); } catch (e) { }
    audio = new Audio(b64(window.__VO).buffer, TL, { S, cue, at });
    await audio.start();
    // ondas de campana (visual) sincronizadas con el audio
    for (const tt of audio.waveTimes) spawnWave(tt.t, tt.pos === 'SW' ? B(-64, -32.5, 0) : B(64, -32.5, 0), tt.s, tt.pos === 'SW' ? 0xffd8a0 : 0xffb070);
    playing = true; loop();
  };
  document.getElementById('again').onclick = () => location.reload();
})();
