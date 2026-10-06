import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { Lensflare, LensflareElement } from 'three/examples/jsm/objects/Lensflare.js';
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
const gtao = new GTAOPass(scene, camera, 960, 540); gtao.blendIntensity = 0.85;
gtao.updateGtaoMaterial({ radius: 2.5, distanceExponent: 1.5, thickness: 2, scale: 1, samples: 12 });
composer.addPass(gtao);
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
  const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); composer.setSize(w, h); if (typeof gtao !== 'undefined') gtao.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// ------------------------------------------------------------------ CIELO Y LUCES
const skyU = { time: { value: 0 }, top: { value: new THREE.Color() }, bot: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3() }, sunCol: { value: new THREE.Color() }, stars: { value: 0 } };
const sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
  vertexShader: 'varying vec3 vP; void main(){ vP=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `uniform vec3 top,bot,sunCol,sunDir; uniform float stars,time; varying vec3 vP;
  float h(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
  float h2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h2(i),h2(i+vec2(1,0)),f.x),mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x),f.y);}
  float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*n2(p);p*=2.03;a*=.5;}return s;}
  void main(){ float y=clamp(vP.y,0.,1.); vec3 c=mix(bot,top,pow(y,.55));
    float s=max(dot(vP,normalize(sunDir)),0.); c+=sunCol*(pow(s,600.)*4.+pow(s,8.)*.25);
    vec3 g=floor(vP*400.); float st=step(.9985,h(g))*stars*smoothstep(0.,.3,vP.y); c+=st;
    vec2 cp=vP.xz/(vP.y+.12)*1.6+vec2(time*.012,time*.004); float cl=smoothstep(.52,.82,fbm(cp))*smoothstep(0.,.18,vP.y);
    vec3 cc=mix(bot*1.15, vec3(1.)*length(top+bot)*.55, .45)+sunCol*pow(s,4.)*.35; c=mix(c,cc,cl*.7);
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

// v2: texturas reales CC0 (Poly Haven) con mapeado triplanar + relieve (normal map)
const TEX = {}; const texLoader = new THREE.TextureLoader();
for (const k in window.__TEX) { const t = texLoader.load(window.__TEX[k]); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (k.endsWith('_diff')) t.colorSpace = THREE.SRGBColorSpace; TEX[k] = t; }
function triplanar(m, name, scale, tint, nStr = 1, wash = 0) {
  m.map = null; m.color.set(tint);
  m.onBeforeCompile = sh => {
    sh.uniforms.tD = { value: TEX[name + '_diff'] }; sh.uniforms.tN = { value: TEX[name + '_nor'] }; sh.uniforms.tS = { value: scale }; sh.uniforms.nS = { value: nStr }; sh.uniforms.wsh = { value: wash };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp; varying vec3 vWn;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 _wp=vec4(transformed,1.); vec3 _n=objectNormal;
        #ifdef USE_INSTANCING
          _wp=instanceMatrix*_wp; _n=mat3(instanceMatrix)*_n;
        #endif
        vWp=(modelMatrix*_wp).xyz; vWn=normalize(mat3(modelMatrix)*_n);`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp; varying vec3 vWn; uniform sampler2D tD,tN; uniform float tS,nS,wsh;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 _N=normalize(vWn); vec3 bw=pow(abs(_N),vec3(4.)); bw/=(bw.x+bw.y+bw.z);
        vec2 ux=vWp.zy*tS, uy=vWp.xz*tS, uz=vWp.xy*tS;
        vec3 tc=texture2D(tD,ux).rgb*bw.x+texture2D(tD,uy).rgb*bw.y+texture2D(tD,uz).rgb*bw.z;
        diffuseColor.rgb*=mix(tc*1.9, vec3(dot(tc,vec3(.33))*1.9+.25), wsh);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
        vec3 nx=texture2D(tN,ux).xyz*2.-1., ny=texture2D(tN,uy).xyz*2.-1., nz=texture2D(tN,uz).xyz*2.-1.;
        nx.xy*=nS; ny.xy*=nS; nz.xy*=nS;
        nx=vec3(nx.xy+_N.zy, abs(nx.z)*_N.x); ny=vec3(ny.xy+_N.xz, abs(ny.z)*_N.y); nz=vec3(nz.xy+_N.xy, abs(nz.z)*_N.z);
        vec3 wn=normalize(nx.zyx*bw.x+ny.xzy*bw.y+nz.xyz*bw.z)*faceDirection;
        normal=normalize((viewMatrix*vec4(wn,0.)).xyz);
        }`);
  };
  m.customProgramCacheKey = () => 'tri_' + name + scale + '_' + wash;
  return m;
}

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
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(b64(window.__GLB).buffer, '');
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
      if (mn === 'Stone') triplanar(m, 'brown_brick_02', 0.5, 0xf6dcbc, 1.1, 0.45);
      else if (mn === 'StoneLight') triplanar(m, 'sandstone_blocks_08', 0.3, 0xfff6ea, 1.0, 0.35);
      else if (mn === 'Plaster') triplanar(m, 'beige_wall_001', 0.15, 0xfff4e6, 0.6);
      else if (mn === 'Floor') triplanar(m, 'marble_01', 0.22, 0xf2e8dc, 0.7);
      else if (mn === 'Alabaster') triplanar(m, 'marble_01', 0.6, 0xfff8ee, 0.6);
      else if (/^Brick/.test(mn)) stoneify(m, 2);
      if (mn === 'Tile') { m.map = tileTex; m.roughness = 0.25; m.metalness = 0.05; m.color.set(0xffffff); }
      if (mn === 'GreenTile') { m.map = greenTex; m.roughness = 0.3; }
      if (mn === 'Lead') { m.map = leadTex; m.color.set(0xc9c5bf); m.metalness = 0.4; m.roughness = 0.45; }
      if (mn === 'Roof') {
        triplanar(m, 'clay_roof_tiles_02', 0.32, 0xc9b7a2, 1.2); const _tri = m.onBeforeCompile;
        // óculos: la cubierta no se dibuja sobre las cúpulas (para verlas desde el interior)
        m.onBeforeCompile = sh => {
          _tri(sh);
          sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uD[11];').replace('void main() {', 'void main() {\n for(int i=0;i<11;i++){ if(length(vWp.xz-uD[i].xy)<uD[i].z) discard; }');
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
    rm.updateMatrixWorld(true); const v = new THREE.Vector3();
    if (!(uv.array instanceof Float32Array)) { rm.geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(p.count * 2), 2)); }
    const uv2 = rm.geometry.attributes.uv;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(rm.matrixWorld); uv2.setXY(i, 0.5 + (v.x - c.x) / (2 * R) * 0.98, 0.5 - (v.z - c.z) / (2 * R) * 0.98); }
    uv2.needsUpdate = true;
  }
  // pivotes de las campanas en la corona (la compresión desplaza el origen de los nodos)
  for (const name of Object.keys(named).filter(n => n.startsWith('Bell_'))) {
    const o = named[name]; const bb = new THREE.Box3().setFromObject(o); const piv = new THREE.Group(); piv.name = name + '_pivot';
    piv.position.set((bb.min.x + bb.max.x) / 2, bb.max.y, (bb.min.z + bb.max.z) / 2); o.parent.add(piv); piv.updateMatrixWorld(true); piv.attach(o);
    piv.material = o.material; named[name] = piv;
  }
  if (groups.Ceiling) groups.Ceiling.visible = false;
  for (const n of ['Pillar', 'PillarGlow']) if (named[n]) named[n].visible = false;   // sustituidos por el camarín de la Virgen
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
  const plaza = new THREE.Mesh(new THREE.PlaneGeometry(600, 76), triplanar(new THREE.MeshStandardMaterial({ roughness: 0.8 }), 'granite_tile', 0.22, 0xf4efe6, 0.8));
  plaza.rotation.x = -Math.PI / 2; plaza.position.copy(B(30, -72, 0.05)); plaza.receiveShadow = true; scene.add(plaza);
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
  water.geometry.dispose(); water.geometry = riverGeometry(); water.rotation.x = -Math.PI / 2; water.position.y = 0.4; scene.add(water);
  // v3: Ebro con reflejo real (Water.js); el agua simple queda como reserva si el equipo va lento
  const nc = document.createElement('canvas'); nc.width = nc.height = 256; const nx = nc.getContext('2d'); const id = nx.createImageData(256, 256);
  const hgt = (x, y) => { let s = 0; for (let k = 1; k <= 6; k++) s += Math.sin((x * (k * 1.7) + y * (k * 0.9)) * Math.PI * 2 / 256 * k + k * 1.3) / k + Math.sin((y * (k * 1.3) - x * (k * 0.6)) * Math.PI * 2 / 256 * k + k) / k; return s; };
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) { const dx = hgt(x + 1, y) - hgt(x - 1, y), dy = hgt(x, y + 1) - hgt(x, y - 1); const n = new THREE.Vector3(-dx * 2.5, -dy * 2.5, 1).normalize(); const i = (y * 256 + x) * 4; id.data[i] = (n.x * .5 + .5) * 255; id.data[i + 1] = (n.y * .5 + .5) * 255; id.data[i + 2] = (n.z * .5 + .5) * 255; id.data[i + 3] = 255; }
  nx.putImageData(id, 0, 0); const ntex = new THREE.CanvasTexture(nc); ntex.wrapS = ntex.wrapT = THREE.RepeatWrapping;
  const wr = new Water(riverGeometry(), { textureWidth: 512, textureHeight: 512, waterNormals: ntex, sunDirection: new THREE.Vector3(1, .3, 0), sunColor: 0xffffff, waterColor: 0x0b2a2c, distortionScale: 2.2, fog: true });
  wr.rotation.x = -Math.PI / 2; wr.position.y = 0.45; wr.material.uniforms.size.value = 6; scene.add(wr);
  water.visible = false; waterU.reflect = wr; waterU.simple = water;

  // Puente de Piedra (esquemático, aguas abajo)
  const bridgeM = triplanar(new THREE.MeshStandardMaterial({ roughness: 0.9 }), 'sandstone_blocks_08', 0.3, 0xe0c8ae, 1.0);
  
  CITY.bridges.forEach(b => extrudePoly(b.p, 5.5, 8.5, bridgeM));
  // edificios del entorno (Ayuntamiento, Lonja, La Seo) — volúmenes aproximados
  const bm = triplanar(new THREE.MeshStandardMaterial({ roughness: 0.95 }), 'brown_brick_02', 0.45, 0xe6c2a0, 1.0);
  [].forEach(([x, y, sx, sy, h]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sy), bm); m.position.copy(B(x, y, h / 2)); m.castShadow = m.receiveShadow = true; scene.add(m);
  });
  
  // v4: edificios reales de OpenStreetMap (planta y altura), alineados con el modelo
  buildRealCity();
  // relleno procedural solo FUERA de la zona cubierta por OSM (horizonte lejano)
  const N = 1400, box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
  const roof = new THREE.ConeGeometry(0.75, 0.35, 4, 1); roof.rotateY(Math.PI / 4); roof.translate(0, 0.175, 0);
  const im = new THREE.InstancedMesh(box, triplanar(new THREE.MeshStandardMaterial({ roughness: 0.95 }), 'beige_wall_001', 0.12, 0xffffff, 0.8), N);
  const ir = new THREE.InstancedMesh(roof, triplanar(new THREE.MeshStandardMaterial({ roughness: 0.9 }), 'clay_roof_tiles_02', 0.25, 0xffffff, 1.0), N);
  const d = new THREE.Object3D(); let n = 0; let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const cols = [0xd8c2a0, 0xc9a882, 0xe3d4ba, 0xb98d6a, 0xd6b58e];
  const rcol = [0xa0583a, 0x9a6046, 0xb36a48, 0x8c5a44];
  while (n < N) {
    const x = (rnd() - 0.5) * 4400, y = (rnd() - 0.5) * 4400;
    if (Math.abs(x) < 1150 && Math.abs(y) < 1150) continue;      // zona con edificios reales (OSM)
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

// ------------------------------------------------------------------ v4: CIUDAD REAL (© colaboradores de OpenStreetMap, ODbL)
const CITY = window.__CITY;
const TN_POS = [-160, -345];   // Torre Nueva: plaza de San Felipe (ubicación aproximada, junto a la iglesia de San Felipe)
function riverGeometry() {
  const shapes = CITY.water.map(w => { const s = new THREE.Shape(w.o.map(p => new THREE.Vector2(p[0], p[1]))); w.i.forEach(h => s.holes.push(new THREE.Path(h.map(p => new THREE.Vector2(p[0], p[1]))))); return s; });
  return new THREE.ShapeGeometry(shapes, 1);
}
function extrudePoly(P, z0, z1, mat) {
  const s = new THREE.Shape(P.map(p => new THREE.Vector2(p[0], p[1])));
  const g = new THREE.ExtrudeGeometry(s, { depth: z1 - z0, bevelEnabled: false }); g.rotateX(-Math.PI / 2); g.translate(0, z0, 0);
  const me = new THREE.Mesh(g, mat); me.castShadow = me.receiveShadow = true; scene.add(me); return me;
}
// fachada con ventanas por planta (textura procedural; UV: u = metros a lo largo del muro, v = altura)
const facadeTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(0,0,0,.06)'; for (let i = 0; i < 400; i++) g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  const win = (x, y, ww, hh) => { g.fillStyle = '#2b2622'; g.fillRect(x, y, ww, hh); g.fillStyle = 'rgba(160,190,210,.35)'; g.fillRect(x + 3, y + 3, ww - 6, hh * .45);
    g.fillStyle = '#5b4a3a'; g.fillRect(x - 6, y, 5, hh); g.fillRect(x + ww + 1, y, 5, hh); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x - 6, y + hh, ww + 12, 4); };
  win(70, 40, 116, 150);
  g.fillStyle = 'rgba(40,30,25,.55)'; g.fillRect(56, 196, 144, 6);
}, [1, 1]);
function buildRealCity() {
  const P = [], N = [], UV = [], C = [], I = []; let vi = 0;
  const pal = [[0.93, 0.86, 0.74], [0.89, 0.78, 0.62], [0.96, 0.91, 0.82], [0.85, 0.70, 0.55], [0.92, 0.84, 0.70], [0.80, 0.66, 0.52]];
  const RP = [], RI = []; let rvi = 0;
  CITY.buildings.forEach((b, bi) => {
    let pts = b.p; if (pts.length < 3) return;
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    if (Math.hypot(cx - TN_POS[0], cy - TN_POS[1]) < 14) return;
    let ar = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], c = pts[(i + 1) % pts.length]; ar += a[0] * c[1] - c[0] * a[1]; }
    if (ar < 0) pts = pts.slice().reverse();
    const h = b.h, col = b.k ? [0.9, 0.78, 0.62] : pal[bi % pal.length];
    let u = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], c = pts[(i + 1) % pts.length]; const L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 0.05) continue;
      const nx = (c[1] - a[1]) / L, ny = -(c[0] - a[0]) / L;     // normal exterior (Blender)
      const A = B(a[0], a[1], 0), Cc = B(c[0], c[1], 0);
      P.push(A.x, 0, A.z, Cc.x, 0, Cc.z, Cc.x, h, Cc.z, A.x, h, A.z);
      for (let k = 0; k < 4; k++) { N.push(nx, 0, -ny); C.push(...col); }
      const u0 = u / 3.6, u1 = (u + L) / 3.6, v1 = h / 3.3; UV.push(u0, 0, u1, 0, u1, v1, u0, v1); u += L;
      I.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3); vi += 4;
    }
    // cubierta (plana, con textura de teja vista desde arriba)
    const v2 = pts.map(p => new THREE.Vector2(p[0], p[1])); const tri = THREE.ShapeUtils.triangulateShape(v2, []);
    pts.forEach(p => { const q = B(p[0], p[1], h); RP.push(q.x, q.y, q.z); });
    tri.forEach(t => RI.push(rvi + t[0], rvi + t[2], rvi + t[1])); rvi += pts.length;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setIndex(I);
  const wm = new THREE.MeshStandardMaterial({ map: facadeTex, vertexColors: true, roughness: 0.92 });
  const walls = new THREE.Mesh(g, wm); walls.castShadow = walls.receiveShadow = true; scene.add(walls);
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(RP, 3)); rg.setIndex(RI); rg.computeVertexNormals();
  const roofs = new THREE.Mesh(rg, triplanar(new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide }), 'clay_roof_tiles_02', 0.3, 0xd4b49a, 1.0, 0.25));
  roofs.receiveShadow = true; scene.add(roofs);
}

// ------------------------------------------------------------------ v4: LA VIRGEN DEL PILAR (recreación; referencias: fotografía real y catedraldezaragoza.es)
const VN = [36.0, 3.2];   // camarín (posición esquemática dentro de la Santa Capilla)
const virgin = {};
function buildVirgin() {
  const g = new THREE.Group(); scene.add(g); virgin.g = g;
  const base = B(VN[0], VN[1], 0.9);
  // fondo de mármol verde con 72 estrellas (dato oficial)
  const marble = canvasTex(512, 768, (c, w, h) => {
    const gr = c.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#5f7466'); gr.addColorStop(1, '#3f5548'); c.fillStyle = gr; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) { c.strokeStyle = `rgba(${200 + Math.random() * 55},${220 + Math.random() * 35},${210},${0.06 + Math.random() * .1})`; c.lineWidth = .5 + Math.random() * 2; c.beginPath(); let x = Math.random() * w, y = Math.random() * h; c.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (Math.random() - .5) * 90; y += Math.random() * 60; c.lineTo(x, y); } c.stroke(); }
  });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.9), new THREE.MeshStandardMaterial({ map: marble, roughness: 0.25, metalness: 0.1 }));
  panel.position.copy(base).add(new THREE.Vector3(0, 1.95, -0.55)); g.add(panel);
  const starG = new THREE.OctahedronGeometry(0.045, 0); starG.scale(1, 1, 0.3);
  const stars = new THREE.InstancedMesh(starG, new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xcc8a20, emissiveIntensity: 1.2, metalness: 0.9, roughness: 0.3 }), 72);
  const D = new THREE.Object3D(); let k = 0;
  for (let r = 0; r < 9; r++) for (let c = 0; c < 8; c++) { D.position.set(-1.05 + c * 0.3 + (r % 2) * 0.15, 0.35 + r * 0.42, -0.53); D.updateMatrix(); stars.setMatrixAt(k++, D.matrix); }
  stars.position.copy(base); g.add(stars);
  // marco dorado y dosel de plata
  const gold = new THREE.MeshStandardMaterial({ color: 0xd8a84a, metalness: 1, roughness: 0.28, emissive: 0x2a1a00 });
  const silver = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 1, roughness: 0.22 });
  const arch = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.09, 8, 40, Math.PI), gold); arch.position.copy(base).add(new THREE.Vector3(0, 3.4, -0.5)); g.add(arch);
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.4, 0.18), gold); p.position.copy(base).add(new THREE.Vector3(s * 1.3, 1.7, -0.5)); g.add(p); }
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 0.35, 24, 1, true), silver); can.position.copy(base).add(new THREE.Vector3(0, 2.75, -0.15)); g.add(can);
  // la columna (1,70 m · Ø 24 cm), forrada de bronce y plata
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.70, 32), silver); col.position.copy(base).add(new THREE.Vector3(0, 0.85, 0)); g.add(col);
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.12, 24), silver); plinth.position.copy(base).add(new THREE.Vector3(0, 0.06, 0)); g.add(plinth);
  // la imagen (36 cm): silueta sencilla, sin pretender reproducir la talla
  const wood = new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 0.55, metalness: 0.15 });
  const fig = new THREE.Mesh(new THREE.LatheGeometry([[0.07, 0], [0.075, 0.04], [0.06, 0.16], [0.05, 0.25], [0.035, 0.29], [0.03, 0.31], [0.035, 0.33], [0.025, 0.36], [0, 0.365]].map(p => new THREE.Vector2(...p)), 20), wood);
  fig.position.copy(base).add(new THREE.Vector3(0, 1.70, 0)); g.add(fig);
  const child = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), wood); child.position.copy(base).add(new THREE.Vector3(0.05, 1.70 + 0.22, 0.04)); g.add(child);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.05, 12, 1, true), gold); crown.position.copy(base).add(new THREE.Vector3(0, 1.70 + 0.385, 0)); g.add(crown);
  // resplandor (rayos dorados, como en la imagen real)
  const rays = new THREE.Group(); for (let i = 0; i < 48; i++) { const L = i % 2 ? 0.16 : 0.24; const r = new THREE.Mesh(new THREE.BoxGeometry(0.008, L, 0.004), gold); const a = i / 48 * Math.PI * 2; r.position.set(Math.sin(a) * (0.16 + L / 2), Math.cos(a) * (0.16 + L / 2), 0); r.rotation.z = -a; rays.add(r); }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.012, 6, 40), gold); rays.add(ring);
  rays.position.copy(base).add(new THREE.Vector3(0, 1.70 + 0.3, -0.06)); g.add(rays); virgin.rays = rays;
  // el manto (≈ 80 cm de alto, 40 cm arriba y 140 cm abajo; dato oficial) cubre la parte alta de la columna
  const mantoTex = canvasTex(256, 256, (c, w, h) => { c.fillStyle = '#f5f0e6'; c.fillRect(0, 0, w, h); c.strokeStyle = '#c9a050'; c.lineWidth = 6; c.strokeRect(10, 10, w - 20, h - 20);
    c.fillStyle = '#c9a050'; c.font = 'bold 60px Georgia'; c.textAlign = 'center'; c.fillText('✦', w / 2, h / 2 + 20); for (let i = 0; i < 9; i++) { c.fillRect(20 + i * 26, h - 30, 14, 14); } });
  const manto = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.24, 0.8, 32, 1, true), new THREE.MeshStandardMaterial({ map: mantoTex, color: 0xd8d2c8, side: THREE.DoubleSide, roughness: 0.85, transparent: true }));
  manto.position.copy(base).add(new THREE.Vector3(0, 1.70 - 0.4 + 0.02, 0)); g.add(manto); virgin.manto = manto; virgin.mantoY = manto.position.y;
  const spot = new THREE.SpotLight(0xfff0d0, 0, 9, 0.5, 0.6, 1.2); spot.position.copy(base).add(new THREE.Vector3(0, 3.6, 2.6)); spot.target.position.copy(base).add(new THREE.Vector3(0, 1.8, 0)); g.add(spot, spot.target); virgin.spot = spot;
  const glow = new THREE.PointLight(0xffd9a0, 0, 4, 1.5); glow.position.copy(base).add(new THREE.Vector3(0, 2.0, 0.6)); g.add(glow); virgin.glow = glow;
  // más de 450 mantos: uno por instancia, con sus proporciones reales
  const n = 450, mg = new THREE.CylinderGeometry(0.2, 0.7, 0.8, 16, 1, true);
  const mm = new THREE.InstancedMesh(mg, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.6, metalness: 0.15, transparent: true, opacity: 0 }), n);
  const pal = [0xf5f0e6, 0x2f56a6, 0xd9b04a, 0x9c2a2a, 0x2f6b4a, 0xe8d8b8, 0x6a3c8c, 0xf2c6c6, 0x1f3a6e, 0xc9a050];
  virgin.mp = []; for (let i = 0; i < n; i++) { mm.setColorAt(i, new THREE.Color(pal[i % pal.length])); virgin.mp.push({ a: i * 2.39996, r: 3.8 + (i / n) * 10, y: 0.6 + (i % 37) * 0.38, s: 0.15 + Math.random() * 0.1 }); }
  mm.frustumCulled = false; scene.add(mm); virgin.mm = mm;
}
// Ofrenda de Flores (evocación con partículas): montaña de flores ante la basílica
let flowers;
function buildFlowers() {
  const n = 9000, g = new THREE.BufferGeometry(), p = new Float32Array(n * 3), c = new Float32Array(n * 3);
  const pal = [[1, .25, .3], [1, .85, .3], [1, 1, 1], [.95, .45, .7], [1, .55, .2], [.7, .2, .5]];
  for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, r = Math.pow(Math.random(), .7) * 16, hgt = Math.max(0, (1 - r / 16) * 11 * (0.7 + Math.random() * .3));
    const q = B(0 + Math.cos(a) * r, -62 + Math.sin(a) * r * .8, hgt); p.set([q.x, q.y, q.z], i * 3); c.set(pal[i % pal.length], i * 3); }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.setDrawRange(0, 0);
  flowers = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.55, vertexColors: true, sizeAttenuation: true })); scene.add(flowers);
}

// ------------------------------------------------------------------ INTERIOR: techo con óculos bajo las cúpulas
const DOMES = [[0, 0, 11.5 * 0.96], [33, 0, 8 * 0.97], [-33, 0, 8 * 0.97]];
for (const x of [-50, -18, 18, 50]) for (const y of [-21, 21]) DOMES.push([x, y, 6.2 * 0.97]);
function buildCeiling() {
  const sh = new THREE.Shape(); sh.moveTo(-63.5, -32); sh.lineTo(63.5, -32); sh.lineTo(63.5, 32); sh.lineTo(-63.5, 32); sh.lineTo(-63.5, -32);
  for (const [x, y, r] of DOMES) { const p = new THREE.Path(); p.absarc(x, y, r, 0, Math.PI * 2, true); sh.holes.push(p); }
  const g = new THREE.ShapeGeometry(sh, 32); g.rotateX(-Math.PI / 2);
  const m = triplanar(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.9, clippingPlanes: [clipPlane] }), 'beige_wall_001', 0.15, 0xfff2e2, 0.6);
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

// ------------------------------------------------------------------ v3: PALOMAS (documentadas anidando en las torres) y GENTE EN LA PLAZA
const birdU = { time: { value: 0 } };
function buildBirds(n) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.18, 0, 0, 0.16, -0.36, 0, 0.0, 0, 0, -0.18, 0.36, 0, 0.0, 0, 0, 0.16], 3));
  g.computeVertexNormals();
  const ph = new Float32Array(n); for (let i = 0; i < n; i++) ph[i] = Math.random() * 6.28;
  g.setAttribute('phase', new THREE.InstancedBufferAttribute(ph, 1));
  const mat = new THREE.MeshBasicMaterial({ color: 0x3a3c42, side: THREE.DoubleSide });
  mat.onBeforeCompile = sh => { sh.uniforms.time = birdU.time;
    sh.vertexShader = 'attribute float phase; uniform float time;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed.y += sin(time*13.+phase)*0.28*abs(position.x)/0.36;'); };
  const im = new THREE.InstancedMesh(g, mat, n); im.frustumCulled = false; scene.add(im);
  const b = []; for (let i = 0; i < n; i++) { const tw = [[-64, -32.5], [64, -32.5], [-64, 32.5], [64, 32.5]][i % 4]; b.push({ c: B(tw[0], tw[1], 0), r: 6 + Math.random() * 14, h: 40 + Math.random() * 40, w: (0.35 + Math.random() * 0.4) * (Math.random() < .5 ? 1 : -1), a: Math.random() * 6.28, s: 1.6 + Math.random() * 0.8 }); }
  return { im, b };
}
function buildPeople(n) {
  const g = new THREE.CapsuleGeometry(0.24, 1.1, 2, 6); g.translate(0, 0.8, 0);
  const im = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), n); im.castShadow = true;
  const cols = [0x2a2a30, 0x5a4636, 0x7a2f2f, 0x2f4a6a, 0xc9c0b0, 0x3d5a3d, 0x6a6a72];
  const p = []; for (let i = 0; i < n; i++) { p.push({ x: -250 + Math.random() * 520, y: -40 - Math.random() * 54, v: (0.6 + Math.random() * 0.9) * (Math.random() < .5 ? 1 : -1), dy: (Math.random() - .5) * .3 }); im.setColorAt(i, new THREE.Color(cols[i % cols.length])); }
  scene.add(im); return { im, p };
}
function flareTex(inner, outer, size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size; const x = c.getContext('2d');
  const gr = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2); gr.addColorStop(0, inner); gr.addColorStop(0.25, outer); gr.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = gr; x.fillRect(0, 0, size, size); return new THREE.CanvasTexture(c);
}
const flareCarrier = new THREE.PointLight(0xffffff, 0, 1); scene.add(flareCarrier);
const lensflare = new Lensflare();
lensflare.addElement(new LensflareElement(flareTex('rgba(255,250,235,1)', 'rgba(255,200,140,.35)', 256), 420, 0, new THREE.Color(0xffe6c0)));
lensflare.addElement(new LensflareElement(flareTex('rgba(255,210,150,.5)', 'rgba(255,160,90,.08)'), 70, 0.45));
lensflare.addElement(new LensflareElement(flareTex('rgba(160,200,255,.35)', 'rgba(120,160,255,.05)'), 110, 0.7));
lensflare.addElement(new LensflareElement(flareTex('rgba(255,190,120,.4)', 'rgba(255,140,80,.05)'), 50, 0.95));
flareCarrier.add(lensflare);

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
  const c1 = S.goya, c3 = S.bells - 1.2, v1 = cue('virgen', 1).s, v2 = cue('virgen', 2).s, v3 = cue('virgen', 3).s, v4 = cue('virgen', 4).s;
  const t1 = cue('sitios', 1).s, t2 = cue('sitios', 2).s;
  const k1 = cue('bombs', 1).s, k3 = cue('bombs', 2).s, a1 = cue('azuara', 1).s;
  shot(0, S.ebro, [[460, 140, 9], [380, 125, 12]], [[0, 10, 40], [0, 0, 42]], 38, t => t);
  shot(S.ebro, S.rewind, [[380, 125, 12], [240, 112, 10], [120, 105, 24], [10, 140, 52]], [[0, 0, 42], [0, 0, 38], [-20, 0, 40], [0, -10, 30]], 40);
  shot(S.rewind, S.capilla, [[10, 140, 52], [-170, 170, 120], [-240, -40, 150], [-120, -230, 140], [110, -240, 120]], [[0, -10, 30], [0, 0, 20], [0, 0, 20], [0, 0, 20], [10, 0, 25]], 44, t => t);
  shot(S.capilla, S.virgen, [[110, -240, 120], [40, -120, 12], [30, -46, 6], [30, -31, 5.5], [32.5, -17, 4.5], [34.5, -6, 3.2]], [[10, 0, 25], [30, 0, 10], [30, 0, 7], [32, 0, 6], [34, 0, 5], [36, 3.2, 2.8]], 48);
  // LA VIRGEN: acercamiento al camarín
  shot(S.virgen, v1, [[34.5, -6, 3.2], [35.6, -1.2, 2.7], [35.9, 0.9, 2.75]], [[36, 3.2, 2.8], [36, 3.2, 2.75], [36, 3.2, 2.85]], 44);
  shot(v1, v2, [[35.9, 0.9, 2.75], [36.25, 2.0, 2.85]], [[36, 3.2, 2.85], [36, 3.2, 2.87]], 40, t => t);
  shot(v2, v3, [[36.25, 2.0, 2.85], [36.6, 1.4, 2.2], [36.1, 0.8, 1.7]], [[36, 3.2, 2.87], [36, 3.2, 2.2], [36, 3.2, 1.9]], 42);
  shot(v3, v4, [[36.1, 0.8, 1.7], [37.5, -3, 4.5], [36, -6.5, 8], [35.2, 0.2, 2.9]], [[36, 3.2, 1.9], [36, 3.2, 3.5], [36, 3.2, 5], [36, 3.2, 2.5]], 50);
  shot(v4, c1, [[35.2, 0.2, 2.9], [35.85, 1.7, 2.8]], [[36, 3.2, 2.5], [36, 3.2, 2.85]], 46, t => t);
  shot(c1, c3, [[35.85, 1.7, 2.8], [38, -6, 4], [44, -17, 4.5], [48.8, -19.6, 7]], [[36, 3.2, 2.85], [44, -15, 8], [50, -21, 25], [50.15, -21.2, 40]], 60);
  shot(S.bells - 1.2, b1, [[-90, -78, 4], [-84, -60, 30], [-76, -48, 52]], [[-64, -32.5, 20], [-64, -32.5, 40], [-64, -32.5, 58]], 44);
  shot(b1, b2, [[-76, -48, 52], [-68, -40, 58.5], [-62.5, -35, 58.5]], [[-64, -32.5, 58], [-64, -32.5, 57], [-64.5, -32, 56.5]], 52);
  shot(b2, pil, [[-62.5, -35, 58.5], [-61.6, -34.6, 57.2]], [[-64.5, -32, 56.5], [-64, -32.5, 56.2]], 50);
  shot(pil, S.sitios, [[-61.6, -34.6, 57.2], [-62, -35, 57.4], [-100, -110, 95], [-160, -260, 170]], [[-64, -32.5, 56.2], [-64, -32.5, 56.5], [-64, -32.5, 40], [-40, -20, 20]], 50, t => t < .3 ? t * .3 / .3 * .35 : .35 + ease((t - .3) / .7) * .65);
  shot(S.sitios, t1, [[-160, -260, 170], [40, -80, 75], [67.5, -36.8, 56]], [[-40, -20, 20], [64, -32.5, 58], [64, -32.5, 55.6]], 50);
  shot(t1, t2 + 1.5, [[67.5, -36.8, 56], [110, -170, 110], [60, -300, 100]], [[64, -32.5, 55.6], [-80, -230, 40], [-160, -345, 40]], 46);
  shot(t2 + 1.5, S.bombs, [[60, -300, 100], [120, -120, 60], [100, -70, 40]], [[-160, -345, 40], [64, -32.5, 58], [0, 30, 30]], 46);
  shot(S.bombs, k3, [[90, -230, 120], [40, -150, 80], [12, -95, 55]], [[10, 0, 40], [5, 0, 50], [2, 0, 48]], 44, t => t);
  shot(k3, S.azuara, [[20, 2, 3.2], [22.2, 4.4, 3.4]], [[25.3, 6.8, 3.5], [25.4, 7.0, 3.6]], 40, t => t);
  shot(S.azuara, a1, [[2000, -4.6, 1.9], [2000, -3.2, 3.0]], [[2000, 6, 2.6], [2000, 6, 3.2]], 52, t => t);   // (coords de la sala: x desplazada)
  shot(a1, TOTAL + 1, [[-64, -32.5, 59], [-64, -42, 59.5], [-90, -75, 75], [-220, -260, 140], [-300, -380, 160]], [[-64, -32.5, 60], [-64, -32.5, 58], [0, 0, 30], [0, 0, 30]], 48, t => ease(t));
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
  card(cue('rewind', 2).s, cue('rewind', 3).s + 0.01, '<div class="big">1681</div><div class="m">Comienza el templo barroco<br>Trazas: Felipe Sánchez · revisión: Francisco Herrera el Mozo</div>');
  card(cue('rewind', 3).s, at('rewind', 3, 'Y antes'), '<div class="big">h. 1515</div><div class="m">Templo gótico-mudéjar</div>');
  card(at('rewind', 3, 'Y antes'), cue('rewind', 3).e + 0.6, '<div class="big">1118 · 1434</div><div class="m">Templo románico tras la conquista de Alfonso I<br>destruido por un incendio en 1434</div>');
  card(at('rewind', 3, 'gótico'), cue('rewind', 3).e + 0.6, 'Esquema ilustrativo. La forma exacta de los templos anteriores no se conoce.', 'disclaim');
  card(cue('rewind', 3).e + 0.7, S.capilla, '<div class="big" id="yearRoll">1515</div>', 'center');
  card(cue('capilla', 0).s + 0.5, S.virgen, '<div class="k">SANTA CAPILLA</div><div class="big">1750 – 1765</div><div class="m">Ventura Rodríguez · templete oval que guarda la columna</div>');
  // LA VIRGEN DEL PILAR (fuente: catedraldezaragoza.es)
  const V = i => cue('virgen', i).s;
  card(V(0) + 0.4, V(1), '<div class="k">PATRONA DE LA HISPANIDAD · FIESTA, 12 DE OCTUBRE</div><div class="big">LA VIRGEN<br>DEL PILAR</div>');
  card(V(1) + 0.2, V(2), '<div class="k">LA IMAGEN</div><div class="big">36 cm</div><div class="m">Talla de madera, primera mitad del siglo XV<br>Atribuida a Juan de la Huerta (estudios de M.ª Carmen Lacarra)</div>');
  card(V(1) + 0.6, V(3), '<img src="data:image/jpeg;base64,' + window.__VIRGIN + '" alt="Virgen del Pilar"><div class="cap">Fotografía real · Miguel Hermoso Cuesta · CC BY-SA 4.0</div>', 'photo');
  card(V(2) + 0.2, V(3), '<div class="k">LA COLUMNA</div><div class="big">1,70 m</div><div class="m">Jaspe · Ø 24 cm · forrada de bronce y después de plata</div>');
  card(at('virgen', 3, 'Tiene'), at('virgen', 3, 'pero los'), '<div class="big">+ 450</div><div class="m">mantos · uno distinto cada día<br>cada uno de unos 80 cm de alto</div>');
  card(at('virgen', 3, 'pero los') + 0.3, V(4), '<div class="big">2 · 12 · 20</div><div class="m">Días sin manto: la Venida (2 de enero),<br>la fiesta (12 de octubre) y la coronación (20 de mayo de 1905)</div>');
  card(V(4) + 0.3, S.goya, '<div class="k">EL MILAGRO DE CALANDA</div><div class="big">1640</div><div class="m">Miguel Juan Pellicer · amputada en el Hospital de Gracia de Zaragoza<br>29 de marzo de 1640: dice despertar con la pierna · 25 testigos<br>Sentencia del arzobispo Pedro Apaolaza, 27 de abril de 1641</div>');
  card(V(4) + 1.5, S.goya, 'Relato de fe documentado en el proceso canónico; la sentencia lo declaró milagro.', 'disclaim');
  card(V(0) + 1, V(4), 'Camarín y figura: recreación 3D; la talla real no se reproduce. Datos: catedraldezaragoza.es', 'disclaim');
  card(S.goya + 0.4, S.bells, '<div class="k">CÚPULA «REGINA MARTYRUM»</div><div class="big">1780 – 1781</div><div class="m">Francisco de Goya · terminada el 28 de mayo de 1781<br>Su estilo chocó con el de su cuñado y supervisor, Francisco Bayeu</div>');
  card(S.goya + 1.5, S.bells, 'Fotografía real del fresco (Wikimedia Commons, dominio público) proyectada sobre la reconstrucción', 'disclaim');
  card(S.capilla + 3, S.virgen, 'Interior: reconstrucción 3D esquemática basada en documentación disponible', 'disclaim');
  card(cue('bells', 1).s, cue('bells', 2).s, `<div class="k">INVENTARIO DE CAMPANAS</div><div class="cols">
   <div><b>Torre alta de la plaza · 9</b><br>Santa Ana · 1884<br>Campana del reloj · 1764 · Lester &amp; Pack (Londres)<br>La Santiaga · 1771 / 1804 *<br>Santa Isabel · 1971<br>Juana Paula · 1983<br>La Braulia · 1783<br>La Indalecia · 1794<br>Petra Paula · 1971<br><b>La Pilara · 1866</b></div>
   <div><b>Torre baja de la plaza · 6</b><br><b>Campana de los Sitios · 1711 *</b><br>Cuartos de la Torre Nueva · 1508 *<br>Carillón de Correos · 4 · 1940<br><br><b>Trascoro · 1</b><br>Campana de señales · h. 1900</div></div>
   <div class="m small">* La propia ficha da fechas distintas en su texto (1771; 1715 «por verificar»; 1558 «no verificado»).<br>Fuente: Campaners de la Catedral de València (F. Llop i Bayo)</div>`, 'wide');
  card(cue('bells', 2).s + 0.2, S.sitios - 0.5, '<div class="k">CAMPANA</div><div class="big">LA PILARA</div><div class="m">1866 · Andrés de Argos y Eugenio de Zuvieta<br>Ø 157 cm · 2.170 kg</div>');
  card(S.sitios - 6.6, S.sitios - 1, '<div class="tag">BANDEO</div><div class="m">Volteo completo de la campana mayor, reservado a las grandes fiestas</div>');
  card(cue('sitios', 0).s + 2.5, t(1), '<div class="k">CAMPANA</div><div class="big">DE LOS SITIOS</div><div class="m">1711 · Andrés de Asín · Ø 220 cm · 6.165 kg<br>Antes llamada «el Relox»</div>');
  card(t(1) + 1.2, t(2), '<div class="k">TORRE NUEVA · 1504 – 1892</div><div class="m">Torre mudéjar del reloj municipal, inclinada · plaza de San Felipe<br>Antes llamada su campana «el Relox»<br>Esquema ilustrativo; ubicación aproximada</div>');
  card(t(2) + 0.2, S.bombs - 0.5, '<div class="big">1892</div><div class="m">Derribo de la Torre Nueva · sus campanas pasan al Pilar</div>');
  card(cue('bombs', 0).s + 0.3, k(1), '<div class="big">3 · VIII · 1936</div><div class="m">Madrugada</div>');
  card(k(1) + 0.3, at('bombs', 1, 'Ninguna'), '<div class="big">3 o 4</div><div class="m">bombas, según las fuentes</div>');
  card(at('bombs', 1, 'Ninguna'), at('bombs', 1, 'Ninguna') + 2.2, '<div class="big">NINGUNA EXPLOTÓ</div>', 'center');
  card(at('bombs', 1, 'Ninguna') + 2.2, k(2), '<div class="cols"><div><span class="tag">TRADICIÓN</span><br>Milagro</div><div><span class="tag alt">INVESTIGACIÓN</span><br>Fallo de las espoletas<br>o sabotaje (VSCW)</div></div>', 'wide');
  card(k(2) + 0.2, S.azuara, '<div class="k">EXPUESTAS JUNTO A LA SANTA CAPILLA</div><div class="m">Hispana A-6 de 50 kg, según VSCW. Su autenticidad ha sido cuestionada.</div>');
  card(S.azuara + 0.5, cue('azuara', 1).s, 'Recreación. Inscripción documentada por Campaners de la Catedral de València; la letra original no se reproduce.', 'disclaim');
  card(at('azuara', 0, 'José Azuara') + 1.5, cue('azuara', 1).s, '<div class="k">EL ÚLTIMO CAMPANERO</div><div class="m">El «tío» Simeón Millán tocó a mano las campanas del Pilar durante buena parte del siglo XX. Poco después de su muerte, hacia 1964, se electrificaron.</div>');
  card(cue('azuara', 1).s + 0.5, cue('azuara', 1).e + 0.3, '<div class="k">TRES VECES AL DÍA</div><div class="m">La megafonía de las torres difunde la jaculatoria:<br><i>«Bendita y alabada sea la hora en que María Santísima vino en carne mortal a Zaragoza»</i></div>');
  card(cue('azuara', 1).e + 0.3, S.outro + 0.9, '<div class="k">OFRENDA DE FLORES · DESDE EL 12 DE OCTUBRE DE 1958</div><div class="m">La primera reunió a unas 2.000 personas durante dos horas.<br>Hoy dura unas ocho horas en la plaza del Pilar.<br><i>Evocación con partículas; no reproduce la estructura real.</i></div>');
  card(S.outro + 1.2, TOTAL - 1.0, '<div class="title">EL PILAR</div><div class="subtitle">Memoria de piedra y bronce</div><div class="m small" style="margin-top:2vh">Reconstrucción 3D basada en documentación disponible · Fuentes al final</div>', 'center');
  function c(i) { return cue('capilla', i).s; } function t(i) { return cue('sitios', i).s; } function k(i) { return cue('bombs', i).s; }
}

// ------------------------------------------------------------------ BUCLE PRINCIPAL
let audio, t0 = null, waterU, shaftM, stair, birds, people, playing = false;
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
  interiorLights.visible = inside || (t > cue('bombs', 2).s - 0.5 && t < S.azuara);
  shaftM.uniforms.op.value = inside ? 1 : 0; dust.material.opacity = inside ? 0.7 : 0;
  hemi.intensity *= inside ? 0.6 : 1;
  grade.uniforms.warm.value = inside ? 1 : 0.3;

  // fundido a negro: inicio, cortes, final
  let fade = 1 - sm(1.5, 4.5, t);
  for (const cut of [cue('bombs', 2).s, S.azuara, cue('azuara', 1).s]) fade = Math.max(fade, 1 - Math.min(1, Math.abs(t - cut) / 0.45));
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
  const tn = groups.TorreNueva, tns = cue('sitios', 1).s, tnd = cue('sitios', 2).s, TNc = B(TN_POS[0], TN_POS[1], 0);
  if (tn) {
    const on = sm(tns + 0.3, tns + 2.5, t) * (1 - sm(tnd + 2.2, tnd + 4.5, t));
    ghost('TorreNueva', on); tn.position.y = -80 * (1 - sm(tns, tns + 3, t));
    const c = B(-260, -330, 0); tn.rotation.set(0, 0, 0);
    tn.position.x = 0; tn.position.z = 0;
    // inclinación (esquemática) aplicada como rotación alrededor de su base
    tn.matrixAutoUpdate = false; const m = new THREE.Matrix4().makeTranslation(TNc.x, tn.position.y, TNc.z).multiply(new THREE.Matrix4().makeRotationZ(-0.045)).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
    tn.matrix.copy(m);
  }
  const fly = named['Bell_Sitios'];
  if (fly && groups.Bells_SE) {
    if (!fly.userData.home) fly.userData.home = fly.position.clone();
    const k = sm(tnd + 0.4, tnd + 3.6, t), from = B(TN_POS[0], TN_POS[1], 66), to = fly.userData.home;
    if (t > tns && t < tnd + 4) {
      const p = from.clone().lerp(to, k); p.y += Math.sin(k * Math.PI) * 60; fly.position.copy(t < tnd + 0.4 ? from : p);
    } else { fly.position.copy(to); }
  }

  // BOMBAS 1936
  const kb = cue('bombs', 1);
  const bf = groups.BombsFall;
  if (bf) {
    bf.visible = t > kb.s - 0.5 && t < cue('bombs', 2).s;
    if (bf.visible) {
      const k = 0.9 * ease(clamp((t - kb.s + 0.4) / (at('bombs', 1, 'Ninguna') - kb.s + 0.4)));
      const targets = [[10, -62, 1], [20, -5, 33], [-15, 10, 33], [0, 110, 1]];
      bf.children.forEach((o, i) => { const tg = targets[i % 4]; const p = B(tg[0], tg[1], tg[2] + (1 - k) * 95 + 3); o.position.copy(p); o.rotation.set(0, t * 0.6 + i, 0); o.visible = true; o.scale.setScalar(3.2); if (o.material && i === 3) { o.material.transparent = true; o.material.opacity = 0.3; } });
    }
  }
  grade.uniforms.flash.value = 0;
  bombLight.intensity = t > kb.s - 0.5 && t < cue('bombs', 2).s - 0.4 ? 650 : 0;
  // LA VIRGEN: luz, manto que se retira (días 2, 12 y 20), torbellino de 450 mantos
  { const v0 = S.virgen - 1, vEnd = S.goya + 3, on = t > v0 && t < vEnd;
    virgin.spot.intensity = on ? 7 * sm(v0, v0 + 2, t) : 0; virgin.glow.intensity = on ? 1.2 : 0;
    virgin.rays.rotation.z = Math.sin(t * 0.4) * 0.03;
    const pOff = at('virgen', 3, 'pero los') + 0.6, k = sm(pOff, pOff + 2.2, t) * (1 - sm(cue('virgen', 4).s + 1, cue('virgen', 4).s + 3, t));
    virgin.manto.position.y = virgin.mantoY + k * 1.6; virgin.manto.material.opacity = 1 - k; virgin.manto.visible = k < 0.99;
    const mOn = sm(at('virgen', 3, 'Cada'), at('virgen', 3, 'Tiene') + 0.5, t) * (1 - sm(pOff - 0.6, pOff + 0.8, t));
    virgin.mm.visible = mOn > 0.01; virgin.mm.material.opacity = mOn;
    if (virgin.mm.visible) { const D = new THREE.Object3D(), c = B(VN[0], VN[1], 0);
      virgin.mp.forEach((q, i) => { const a = q.a + t * (0.25 + 0.6 / q.r); D.position.set(c.x + Math.cos(a) * q.r, q.y + Math.sin(t * .7 + i) * .2, c.z + Math.sin(a) * q.r); D.rotation.set(Math.sin(t + i) * .3, -a, 0); D.scale.setScalar(0.9 + q.s); D.updateMatrix(); virgin.mm.setMatrixAt(i, D.matrix); });
      virgin.mm.instanceMatrix.needsUpdate = true; } }
  // Ofrenda de Flores: la montaña crece en el desenlace
  { const k = sm(cue('azuara', 1).s + 1, TOTAL - 3, t); flowers.geometry.setDrawRange(0, Math.floor(9000 * k)); }

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
  waterU.time.value = t; waterU.sky.value.copy(skyU.bot.value); skyU.time.value = t;
  if (waterU.reflect) { const W = waterU.reflect.material.uniforms; W.time.value = t * 0.5; W.sunDirection.value.copy(skyU.sunDir.value).normalize(); W.sunColor.value.copy(sun.color).multiplyScalar(Math.min(1, sun.intensity / 2.5)); W.waterColor.value.copy(scene.fog.color).multiplyScalar(0.18); }
  // destello de lente (solo con sol visible)
  const sunVis = skyU.stars.value < 0.5 && !inside && skyU.sunDir.value.y > 0.02;
  lensflare.visible = sunVis; flareCarrier.position.copy(camera.position).addScaledVector(skyU.sunDir.value.clone().normalize(), 3000);
  // velas en la Santa Capilla
  interiorLights.children[0].intensity = 70 * (0.82 + 0.1 * Math.sin(t * 9.1) + 0.08 * Math.sin(t * 23.7 + 1.3));
  // palomas: se agitan con cada golpe de campana
  birdU.time.value = t; let agit = 0; for (const w of waves) { const d = t - w.t; if (d > 0 && d < 8) agit = Math.max(agit, Math.exp(-d * 0.45) * w.strength); }
  { const D = new THREE.Object3D(); const night = t > S.bombs - 3 && t < S.azuara + 2; birds.im.visible = !night && !inside;
    birds.b.forEach((q, i) => { q.a += q.w * (1 + agit * 2.5) * 0.016; const r = q.r * (1 + agit * 1.8), h = q.h + agit * 25 + Math.sin(t * .5 + i) * 3;
      D.position.set(q.c.x + Math.cos(q.a) * r, h, q.c.z + Math.sin(q.a) * r); D.rotation.set(0, -q.a - (q.w > 0 ? 0 : Math.PI), Math.sin(t + i) * .2); D.scale.setScalar(q.s); D.updateMatrix(); birds.im.setMatrixAt(i, D.matrix); });
    birds.im.instanceMatrix.needsUpdate = true; }
  // gente en la plaza (de día y con el templo en pie)
  { const D = new THREE.Object3D(); people.im.visible = !(t > S.bombs - 3 && t < S.azuara) && clipPlane.constant > 300 && !inside;
    people.p.forEach((q, i) => { let x = q.x + q.v * t; x = ((x + 260) % 540 + 540) % 540 - 260; D.position.copy(B(x, q.y + Math.sin(t * .2 + i) * 2, 0)); D.scale.set(1, 1 + (i % 5) * .04, 1); D.updateMatrix(); people.im.setMatrixAt(i, D.matrix); });
    people.im.instanceMatrix.needsUpdate = true; }
  for (const m of ghostMats) m.uniforms.time.value = t;

  // subtítulos y rótulos
  const sb = SUBS.find(s => t >= s.s - 0.05 && t < s.e + 0.35);
  const txt = sb ? sb.text : '';
  if (subEl.dataset.t !== txt) { subEl.dataset.t = txt; subEl.textContent = txt; subEl.classList.toggle('on', !!txt); }
  for (const c of CARDS) c.el.classList.toggle('on', t >= c.t0 && t < c.t1);
}

let frames = 0, slow = 0, lastT = performance.now();
function loop() {
  if (!playing) return;
  // calidad adaptativa: si el equipo no llega a ~35 fps, se desactiva la oclusión ambiental y se baja la resolución
  const now = performance.now(), dt = now - lastT; lastT = now; frames++;
  if (frames > 30 && dt > 28) slow++; else if (slow > 0) slow -= 0.25;
  if (slow > 45 && waterU.reflect.visible) { waterU.reflect.visible = false; waterU.simple.visible = true; slow = 0; }
  else if (slow > 45 && gtao.enabled) { gtao.enabled = false; slow = 0; }
  else if (slow > 45 && !gtao.enabled && renderer.getPixelRatio() > 1) { renderer.setPixelRatio(1); resize(); slow = 0; }
  const t = audio.time();
  update(t);
  composer.render();
  if (t >= TOTAL) { playing = false; document.getElementById('end').classList.add('on'); document.body.classList.remove('playing'); return; }
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------ ARRANQUE
(async function init() {
  const btn = document.getElementById('start');
  waterU = buildCity(); shaftM = buildCeiling(); stair = buildStair(); birds = buildBirds(140); people = buildPeople(220); buildVirgin(); buildFlowers();
  await loadModel();
  // bombas que caen: 3 + 1 dudosa (las fuentes no coinciden)
  const bf = groups.BombsFall; const src = bf.children[0];
  for (let i = 0; i < 3; i++) { const c = src.clone(); c.material = src.material.clone(); bf.add(c); }
  // cada bomba dentro de un contenedor propio (la compresión aplica escala/desplazamiento al nodo)
  for (const o of [...bf.children]) { const w = new THREE.Group(); bf.add(w); w.attach(o); o.position.sub(new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3())); w.userData.mesh = o; w.material = o.material; }
  bf.children.filter(o => o.isMesh).forEach(o => bf.remove(o));
  bf.children.forEach(w => { const o = w.userData.mesh; o.material = o.material.clone(); o.material.clippingPlanes = []; o.material.color.set(0xb8c0ca); o.material.emissive = new THREE.Color(0x5a6270); w.material = o.material; const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.12, 14, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xcfe3ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })); tr.position.y = 8.6 / 3.2; tr.scale.setScalar(1 / 3.2); w.add(tr); });
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
