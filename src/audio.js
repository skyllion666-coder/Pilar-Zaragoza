// Motor de audio: narración + música original + campanas sintetizadas + diseño sonoro (Web Audio API).
const N = { D2: 73.42, F2: 87.31, G2: 98, A2: 110, Bb2: 116.54, C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196, A3: 220, Bb3: 233.08, C4: 261.63, Cs4: 277.18, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392, A4: 440, Bb4: 466.16, C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46 };
const CH = {
  Dm: ['D3', 'F3', 'A3', 'D4'], Bb: ['Bb2', 'D3', 'F3', 'Bb3'], F: ['F2', 'C3', 'F3', 'A3'], C: ['C3', 'E3', 'G3', 'C4'], Gm: ['G2', 'D3', 'G3', 'Bb3'],
  A: ['A2', 'E3', 'A3', 'Cs4'], D: ['D3', 'A3', 'D4', 'F4'], Dmaj: ['D3', 'A3', 'D4', 'F4']
};
const bellF = D => 145 * 1.57 / D;   // altura relativa según diámetro (aproximación acústica, no medición)

export class Audio {
  constructor(voBuf, TL, h) {
    this.voBuf = voBuf; this.TL = TL; this.h = h; this.ev = []; this.waveTimes = [];
  }
  time() { return this.ctx ? Math.max(0, this.ctx.currentTime - this.T0) : 0; }
  async start() {
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    await ctx.resume();
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3; comp.connect(ctx.destination);
    this.master = ctx.createGain(); this.master.gain.value = 0.9; this.master.connect(comp);
    // reverberación sintética (nave de piedra)
    const len = ctx.sampleRate * 5, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    this.rev = ctx.createConvolver(); this.rev.buffer = ir; const rg = ctx.createGain(); rg.gain.value = 0.55; this.rev.connect(rg); rg.connect(this.master);
    this.music = ctx.createGain(); this.music.gain.value = 0.5; this.music.connect(this.master);
    const ms = ctx.createGain(); ms.gain.value = 0.5; this.music.connect(ms); ms.connect(this.rev);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.8; this.sfx.connect(this.master);
    this.bells = ctx.createGain(); this.bells.gain.value = 0.55; this.bells.connect(this.master);
    const bs = ctx.createGain(); bs.gain.value = 0.9; this.bells.connect(bs); bs.connect(this.rev);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const vo = await ctx.decodeAudioData(this.voBuf.slice(0));
    this.T0 = ctx.currentTime + 0.25;
    const src = ctx.createBufferSource(); src.buffer = vo; const vg = ctx.createGain(); vg.gain.value = 1.15; src.connect(vg); vg.connect(this.master);
    const vs = ctx.createGain(); vs.gain.value = 0.08; vg.connect(vs); vs.connect(this.rev);
    src.start(this.T0);
    this.compose();
    this.master.gain.setTargetAtTime(0.0001, this.T0 + this.TL.total - 2.6, 0.7);
    // ducking de la música bajo la voz
    const g = this.music.gain; g.setValueAtTime(0.5, this.T0);
    for (const c of this.TL.cues) { g.setTargetAtTime(0.26, this.T0 + c.s - 0.3, 0.25); g.setTargetAtTime(0.5, this.T0 + c.e + 0.2, 0.6); }
    this.ev.sort((a, b) => a.t - b.t); this.ei = 0;
    this.timer = setInterval(() => this.pump(), 40); this.pump();
  }
  at(t, fn) { this.ev.push({ t, fn }); }
  pump() {
    const now = this.time() + 0.35;
    while (this.ei < this.ev.length && this.ev[this.ei].t < now) { const e = this.ev[this.ei++]; try { e.fn(this.T0 + e.t); } catch (err) { console.warn(err); } }
  }
  // ---------------------------------------------------------- instrumentos
  env(g, w, a, peak, d, sustain = 0, rel = 0) {
    g.gain.setValueAtTime(0.0001, w); g.gain.exponentialRampToValueAtTime(peak, w + a);
    if (rel) { g.gain.setValueAtTime(peak, w + a + d); g.gain.exponentialRampToValueAtTime(0.0001, w + a + d + rel); }
    else g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), w + a + d);
  }
  bell(w, D, gain = 1, pan = 0) {
    const ctx = this.ctx, f = bellF(D);
    const P = [[0.5, .5, 12], [1, .7, 8], [1.19, .6, 6], [1.5, .25, 4], [2, .9, 5], [2.5, .3, 3], [2.66, .25, 2.5], [3, .3, 2], [4, .15, 1.2], [5.33, .08, .8]];
    const out = ctx.createGain(); out.gain.value = gain * 0.12; const p = ctx.createStereoPanner(); p.pan.value = pan; out.connect(p); p.connect(this.bells);
    const k = 0.6 + D * 0.4;
    const light = gain < 0.3;   // repiques: menos parciales para aligerar la CPU
    for (const [r, a, d] of (light ? P.slice(0, 7) : P)) for (const det of (light ? [0] : [-0.35, 0.35])) {
      const o = ctx.createOscillator(); o.frequency.value = f * r + det * r; const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, w); g.gain.exponentialRampToValueAtTime(a, w + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, w + d * k);
      o.connect(g); g.connect(out); o.start(w); o.stop(w + d * k + 0.1);
    }
    const n = ctx.createBufferSource(); n.buffer = this.noise; const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 3; bp.Q.value = 2;
    const ng = ctx.createGain(); this.env(ng, w, 0.002, 0.8, 0.06); n.connect(bp); bp.connect(ng); ng.connect(out); n.start(w); n.stop(w + 0.1);
  }
  pad(w, dur, chord, gain = 0.1, vowel = true) {
    const ctx = this.ctx, out = ctx.createGain(); this.env(out, w, Math.min(1.8, dur * .35), gain, Math.max(0.1, dur - 1.8), 0, 2.2); out.connect(this.music);
    const mix = ctx.createGain(); mix.gain.value = 0.25;
    if (vowel) { for (const [fq, q, a] of [[730, 7, 1], [1090, 8, .6], [2440, 9, .3]]) { const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fq; bp.Q.value = q; const g = ctx.createGain(); g.gain.value = a * 2.4; mix.connect(bp); bp.connect(g); g.connect(out); } }
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; mix.connect(lp); lp.connect(out);
    for (const n of CH[chord]) for (const det of [-7, 7]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = N[n]; o.detune.value = det;
      const v = ctx.createOscillator(); v.frequency.value = 4.6 + Math.random(); const vg = ctx.createGain(); vg.gain.value = 3; v.connect(vg); vg.connect(o.detune);
      o.connect(mix); o.start(w); o.stop(w + dur + 2.5); v.start(w); v.stop(w + dur + 2.5);
    }
  }
  drone(w, dur, f, gain = 0.12, cut = 380) {
    const ctx = this.ctx, out = ctx.createGain(); this.env(out, w, 2.5, gain, Math.max(.1, dur - 2.5), 0, 3); out.connect(this.music);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cut; lp.Q.value = 2; lp.connect(out);
    const l = ctx.createOscillator(); l.frequency.value = 0.07; const lg = ctx.createGain(); lg.gain.value = cut * 0.4; l.connect(lg); lg.connect(lp.frequency); l.start(w); l.stop(w + dur + 3.5);
    for (const [m, ty] of [[1, 'sawtooth'], [1.003, 'sawtooth'], [0.5, 'sine'], [1.5, 'triangle']]) { const o = ctx.createOscillator(); o.type = ty; o.frequency.value = f * m; o.connect(lp); o.start(w); o.stop(w + dur + 3.5); }
  }
  pluck(w, f, gain = 0.15, pan = 0) {
    const ctx = this.ctx, out = ctx.createGain(); this.env(out, w, 0.005, gain, 2.2); const p = ctx.createStereoPanner(); p.pan.value = pan; out.connect(p); p.connect(this.music);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(f * 8, w); lp.frequency.exponentialRampToValueAtTime(f * 1.5, w + 1); lp.connect(out);
    for (const [m, a, ty] of [[1, 1, 'triangle'], [2, .35, 'sine'], [3, .12, 'sawtooth']]) { const o = ctx.createOscillator(); o.type = ty; o.frequency.value = f * m; const g = ctx.createGain(); g.gain.value = a; o.connect(g); g.connect(lp); o.start(w); o.stop(w + 2.4); }
  }
  boom(w, gain = 0.6) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(75, w); o.frequency.exponentialRampToValueAtTime(38, w + 1.5);
    this.env(g, w, 0.01, gain, 3); o.connect(g); g.connect(this.sfx); o.start(w); o.stop(w + 3.2);
    this.noiseHit(w, 180, 2, gain * 0.5, 1.5, 'lowpass');
  }
  noiseHit(w, f, q, gain, dur, type = 'bandpass', f2 = null, a = 0.005) {
    const ctx = this.ctx, n = ctx.createBufferSource(); n.buffer = this.noise; n.loop = true;
    const bf = ctx.createBiquadFilter(); bf.type = type; bf.frequency.setValueAtTime(f, w); if (f2) bf.frequency.exponentialRampToValueAtTime(f2, w + dur); bf.Q.value = q;
    const g = ctx.createGain(); this.env(g, w, a, gain, dur); n.connect(bf); bf.connect(g); g.connect(this.sfx); n.start(w); n.stop(w + dur + a + 0.1);
    return g;
  }
  swell(w, dur, f1, f2, gain) { const g = this.noiseHit(w, f1, 1.2, gain, 0.01, 'bandpass', null, dur); }
  whoosh(w, dur = 1.6, gain = 0.25) {
    const ctx = this.ctx, n = ctx.createBufferSource(); n.buffer = this.noise; n.loop = true; const bf = ctx.createBiquadFilter(); bf.type = 'bandpass'; bf.Q.value = 1.4;
    bf.frequency.setValueAtTime(250, w); bf.frequency.exponentialRampToValueAtTime(1800, w + dur * .5); bf.frequency.exponentialRampToValueAtTime(300, w + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, w); g.gain.exponentialRampToValueAtTime(gain, w + dur * .5); g.gain.exponentialRampToValueAtTime(0.0001, w + dur);
    n.connect(bf); bf.connect(g); g.connect(this.sfx); n.start(w); n.stop(w + dur + 0.1);
  }
  wind(w, dur, gain = 0.12, f = 500) {
    const ctx = this.ctx, n = ctx.createBufferSource(); n.buffer = this.noise; n.loop = true; const bf = ctx.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = f; bf.Q.value = 0.8;
    const l = ctx.createOscillator(); l.frequency.value = 0.13; const lg = ctx.createGain(); lg.gain.value = f * 0.5; l.connect(lg); lg.connect(bf.frequency);
    const g = ctx.createGain(); this.env(g, w, 2, gain, Math.max(.1, dur - 2), 0, 2); n.connect(bf); bf.connect(g); g.connect(this.sfx); n.start(w); n.stop(w + dur + 2.2); l.start(w); l.stop(w + dur + 2.2);
  }
  plane(w, dur) {
    const ctx = this.ctx, out = ctx.createGain(); out.gain.setValueAtTime(0.0001, w); out.gain.exponentialRampToValueAtTime(0.22, w + dur * .55); out.gain.exponentialRampToValueAtTime(0.0001, w + dur);
    const p = ctx.createStereoPanner(); p.pan.setValueAtTime(-0.9, w); p.pan.linearRampToValueAtTime(0.9, w + dur); out.connect(p); p.connect(this.sfx);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; lp.connect(out);
    for (const m of [1, 1.01, 2.02]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(92 * m, w); o.frequency.setValueAtTime(92 * m, w + dur * .5); o.frequency.linearRampToValueAtTime(78 * m, w + dur); const am = ctx.createOscillator(); am.frequency.value = 23; const ag = ctx.createGain(); ag.gain.value = 0.3; const g = ctx.createGain(); g.gain.value = 0.5; am.connect(ag); ag.connect(g.gain); o.connect(g); g.connect(lp); o.start(w); o.stop(w + dur); am.start(w); am.stop(w + dur); }
  }
  whistle(w, dur) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(1500, w); o.frequency.exponentialRampToValueAtTime(420, w + dur);
    g.gain.setValueAtTime(0.0001, w); g.gain.exponentialRampToValueAtTime(0.05, w + dur * .7); g.gain.setValueAtTime(0.05, w + dur - 0.02); g.gain.linearRampToValueAtTime(0.0001, w + dur);
    o.connect(g); g.connect(this.sfx); o.start(w); o.stop(w + dur + 0.05);
  }
  // ---------------------------------------------------------- partitura
  compose() {
    const { S, cue, at } = this.h, T = this.TL.total, A = (t, fn) => this.at(t, fn);
    const melody = (t0, beat, notes, gain = 0.13) => { let t = t0; for (const [n, b] of notes) { if (n) A(t, w => this.pluck(w, N[n], gain, (Math.random() - .5) * .5)); t += b * beat; } };
    // INTRO
    A(0, w => this.wind(w, S.ebro + 12, 0.1, 450));
    A(0.6, w => this.drone(w, S.rewind - 0.6, N.D2, 0.13));
    A(1.4, w => this.bell(w, 1.57, 0.9, -0.2)); this.waveTimes.push({ t: 1.4, pos: 'SW', s: 0.6 });
    // EBRO: tema principal (original) sobre Dm – Bb – F – C
    const prog = ['Dm', 'Bb', 'F', 'C', 'Dm'];
    prog.forEach((c, i) => A(S.ebro + i * 2.6, w => this.pad(w, 3.0, c, 0.07)));
    const beat = 0.62;
    melody(S.ebro + 0.4, beat, [['A4', 1], ['D5', 1], ['C5', .5], ['A4', 1.5], ['G4', 1], ['A4', 1], ['F4', 1], ['E4', 1], ['D4', 2], ['A3', 1], ['D4', 1], ['F4', .5], ['E4', .5], ['D4', 2]]);
    // REBOBINADO: tic-tac acelerando, graves, crepitar del incendio
    const r1 = cue('rewind', 1), r3 = cue('rewind', 3);
    for (let t = S.rewind - 0.5, dt = 0.5; t < r3.e + 0.6; t += dt, dt = Math.max(0.14, dt * 0.985)) A(t, w => this.noiseHit(w, 3200, 6, 0.06, 0.03, 'bandpass'));
    A(S.rewind - 1.2, w => this.whoosh(w, 2.4, 0.3));
    A(S.rewind, w => this.drone(w, S.capilla - S.rewind, N.A2, 0.09, 300));
    ['Gm', 'Dm', 'Bb', 'A', 'Gm', 'Dm'].forEach((c, i) => A(S.rewind + i * 3.8, w => this.pad(w, 4.2, c, 0.05)));
    A(r1.s + 0.4, w => this.noiseHit(w, 90, 1, 0.5, 3.2, 'lowpass'));
    A(at('rewind', 1, 'La de la plaza'), w => this.noiseHit(w, 90, 1, 0.5, 3, 'lowpass'));
    A(r3.s, w => this.noiseHit(w, 300, 0.7, 0.25, 2.6, 'lowpass', 60));
    const fi = at('rewind', 3, 'incendio');
    for (let k = 0; k < 70; k++) A(fi + Math.random() * 3.2, w => this.noiseHit(w, 1500 + Math.random() * 3000, 3, 0.05 + Math.random() * .05, 0.02 + Math.random() * .04));
    A(fi, w => this.noiseHit(w, 400, 0.6, 0.12, 3.5, 'lowpass'));
    // reconstrucción: arpegio ascendente acelerado -> acorde mayor
    const rb0 = r3.e + 0.8, rb1 = S.capilla - 0.6, arp = ['D3', 'F3', 'A3', 'D4', 'F4', 'A4', 'D5', 'F5'];
    let ii = 0; for (let t = rb0, dt = 0.32; t < rb1; t += dt, dt = Math.max(0.09, dt * 0.93), ii++) { const n = arp[ii % arp.length]; A(t, w => this.pluck(w, N[n], 0.09)); }
    A(rb0, w => this.whoosh(w, rb1 - rb0, 0.18));
    A(rb1, w => { this.pad(w, 4, 'Dmaj', 0.12); this.boom(w, 0.5); });
    // CAPILLA: pasos, coro
    for (let t = S.capilla + 3.2; t < cue('capilla', 1).s; t += 0.62) A(t, w => this.noiseHit(w, 700, 1.5, 0.08, 0.07, 'lowpass'));
    A(S.capilla, w => this.drone(w, S.bells - S.capilla, N.D2, 0.08, 260));
    ['Dm', 'Gm', 'Bb', 'A', 'Dm', 'F', 'C', 'A', 'Dm'].forEach((c, i) => A(S.capilla + 2 + i * 3.3, w => this.pad(w, 3.8, c, 0.07)));
    // CAMPANAS: inventario (cada campana suena una vez, de aguda a grave)
    A(S.bells - 1.3, w => this.whoosh(w, 2.2, 0.25));
    A(S.bells - 1, w => this.wind(w, S.sitios - S.bells + 4, 0.15, 700));
    A(S.bells, w => this.drone(w, S.sitios - S.bells, N.D2, 0.06, 200));
    const inv = [0.52, 0.62, 0.73, 0.80, 1.00, 1.30, 1.30, 1.40];
    inv.forEach((D, i) => A(cue('bells', 1).s + 0.4 + i * 0.75, w => this.bell(w, D, 0.35, -0.6 + i * 0.15)));
    A(cue('bells', 2).s + 0.2, w => this.bell(w, 1.57, 0.6, 0));
    // BANDEO de la Pilara: golpes al pasar por la vertical + repique de las pequeñas
    const p0 = S.sitios - 6.8, pd = 6.5;
    const ez = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    let last = 0; for (let k = 0.002; k < 1; k += 0.002) { const th = 4 * Math.PI * ez(k); const c = Math.floor(th / Math.PI + 0.5); if (c > last) { last = c; const t = p0 + k * pd; A(t, w => this.bell(w, 1.57, 1.1, -0.1)); this.waveTimes.push({ t, pos: 'SW', s: 0.8 }); } }
    const small = [0.52, 0.62, 0.73, 0.80, 1.0];
    for (let t = p0 + 0.6, i = 0; t < S.sitios + 1.5; t += 0.21, i++) { const D = small[[0, 2, 1, 3, 4, 2, 1, 0][i % 8]]; A(t, w => this.bell(w, D, 0.22 + Math.random() * .08, (Math.random() - .5) * .8)); }
    A(p0 + 2.2, w => this.whoosh(w, 3.2, 0.35));
    // SITIOS: tono grave, Torre Nueva, vuelo de la campana, golpes de las horas
    A(S.sitios, w => this.drone(w, S.bombs - S.sitios, N.D2 * 0.5 * 2, 0.11, 240));
    ['Dm', 'Bb', 'Gm', 'A', 'Dm', 'Gm', 'A'].forEach((c, i) => A(S.sitios + 1 + i * 3.6, w => this.pad(w, 4.0, c, 0.06, false)));
    A(cue('sitios', 0).s + 2.2, w => this.bell(w, 2.2, 0.5, 0.2));
    const tnd = cue('sitios', 2).s;
    A(cue('sitios', 1).s + 0.3, w => this.noiseHit(w, 120, 0.8, 0.3, 3, 'lowpass'));
    A(tnd + 0.4, w => this.whoosh(w, 3.3, 0.35));
    A(tnd + 3.6, w => { this.boom(w, 0.35); this.noiseHit(w, 2500, 8, 0.08, 0.9); });
    for (let i = 0; i < 3; i++) { const t = S.bombs - 4.6 + i * 1.6; A(t, w => this.bell(w, 2.2, 1.3, 0.25)); this.waveTimes.push({ t, pos: 'SE', s: 1.0 }); }
    // 1936: avión, silbidos, silencio, golpe sordo
    const k1 = cue('bombs', 1).s, nin = at('bombs', 1, 'Ninguna');
    A(S.bombs - 0.5, w => this.wind(w, 25, 0.06, 300));
    A(cue('bombs', 0).s + 1, w => this.plane(w, 9));
    A(S.bombs, w => this.drone(w, nin - S.bombs, N.D2, 0.08, 180));
    for (let i = 0; i < 3; i++) A(k1 + i * 0.3, w => this.whistle(w, nin - k1 - i * 0.3));
    A(nin, w => { this.boom(w, 0.45); });
    ['Dm', 'Bb', 'Gm', 'A'].forEach((c, i) => A(nin + 1.2 + i * 3.4, w => this.pad(w, 3.8, c, 0.05)));
    // AZUARA: tema en solitario, después repique final
    const a1 = cue('azuara', 1).s;
    A(S.azuara, w => this.drone(w, a1 - S.azuara, N.D2, 0.06, 200));
    melody(S.azuara + 1.2, 0.8, [['A4', 1], ['D5', 1], ['C5', .5], ['A4', 1.5], ['G4', 1], ['A4', 1], ['F4', 1], ['E4', 1], ['D4', 3]], 0.11);
    ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'C', 'Dmaj'].forEach((c, i) => A(a1 + i * 2.8, w => this.pad(w, 3.4, c, 0.1)));
    melody(a1 + 0.2, 0.7, [['D4', 1], ['F4', 1], ['A4', 1], ['D5', 2], ['C5', 1], ['A4', 1], ['G4', 1], ['A4', 2], ['F4', 1], ['G4', 1], ['A4', 1], ['D5', 3]], 0.12);
    A(a1, w => this.boom(w, 0.4));
    for (let t = a1 + 0.5, i = 0; t < T - 3; t += 0.24, i++) { const D = [0.52, 0.73, 0.62, 0.80, 1.0, 0.73, 0.62, 1.3][i % 8]; A(t, w => this.bell(w, D, 0.16, (Math.random() - .5))); }
    for (let t = a1 + 0.8; t < T - 3; t += 2.4) { A(t, w => this.bell(w, 1.57, 0.7, -0.3)); this.waveTimes.push({ t, pos: 'SW', s: 0.7 }); }
    for (let t = a1 + 2.0; t < T - 3; t += 4.8) { A(t, w => this.bell(w, 2.2, 0.8, 0.3)); this.waveTimes.push({ t, pos: 'SE', s: 0.9 }); }
    A(T - 3.5, w => this.bell(w, 2.2, 1.0, 0));
  }
}
