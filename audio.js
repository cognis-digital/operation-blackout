/* ============================================================
   AUDIO ENGINE v2 — Much more realistic procedural sounds
   ============================================================ */

const AudioEngine = (() => {
  let ctx, masterGain, sfxGain;
  let initialized = false;
  let masterVolume = 0.7;

  function init() {
    if (initialized) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      sfxGain = ctx.createGain();
      masterGain.gain.value = masterVolume;
      sfxGain.gain.value = 1;
      sfxGain.connect(masterGain);
      masterGain.connect(ctx.destination);
      initialized = true;
    } catch (e) { console.warn('Audio failed', e); }
  }

  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }
  function setVolume(v) { masterVolume = v; if (masterGain) masterGain.gain.value = v; }

  function spatial(pos, listenerPos) {
    if (!pos || !listenerPos) return 1;
    const dx = pos.x - listenerPos.x;
    const dy = pos.y - listenerPos.y;
    const dz = pos.z - listenerPos.z;
    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
    return Math.max(0.05, Math.min(1, 25 / (dist + 5)));
  }

  // Create noise buffer (cached)
  let noiseBuffer = null;
  function getNoiseBuffer() {
    if (noiseBuffer) return noiseBuffer;
    const len = ctx.sampleRate * 2;
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return noiseBuffer;
  }

  /* ====================================================
     GUNSHOT — Multi-layer realistic gun sound
     Layers: Initial bang (powder), crack (supersonic),
             body resonance, mechanical action, tail
     ==================================================== */
  function playGunshot(type = 'rifle1', volume = 1) {
    if (!initialized) return;
    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = volume;
    out.connect(sfxGain);

    // Compressor for punch
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 4;
    out.connect(comp);
    comp.connect(sfxGain);

    // Profile by weapon type
    const profiles = {
      'rifle1': { bang: 0.9, crack: 0.7, body: 80, tail: 0.15, freq: 2500 },
      'rifle2': { bang: 1.0, crack: 0.8, body: 60, tail: 0.18, freq: 2000 }, // AK heavier
      'rifle3': { bang: 0.85, crack: 0.6, body: 90, tail: 0.16, freq: 2400 },
      'sniper1': { bang: 1.2, crack: 1.0, body: 50, tail: 0.35, freq: 1500 },
      'sniper2': { bang: 1.4, crack: 1.1, body: 40, tail: 0.45, freq: 1200 }, // .338
      'smg1': { bang: 0.7, crack: 0.5, body: 150, tail: 0.10, freq: 3000 },
      'smg2': { bang: 0.65, crack: 0.55, body: 140, tail: 0.10, freq: 2800 },
      'shotgun1': { bang: 1.3, crack: 0.4, body: 70, tail: 0.30, freq: 1200 },
      'pistol1': { bang: 0.55, crack: 0.4, body: 180, tail: 0.08, freq: 2200 },
      'pistol2': { bang: 0.5, crack: 0.35, body: 200, tail: 0.07, freq: 2400 },
      'pistol3': { bang: 1.1, crack: 0.8, body: 90, tail: 0.20, freq: 1800 },
    };
    const p = profiles[type] || profiles['rifle1'];

    // === Layer 1: INITIAL BANG (low-freq powder ignition) ===
    const bangOsc = ctx.createOscillator();
    const bangG = ctx.createGain();
    bangOsc.type = 'sawtooth';
    bangOsc.frequency.setValueAtTime(p.body * 1.5, now);
    bangOsc.frequency.exponentialRampToValueAtTime(p.body * 0.4, now + 0.05);
    bangG.gain.setValueAtTime(0, now);
    bangG.gain.linearRampToValueAtTime(p.bang, now + 0.002);
    bangG.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    bangOsc.connect(bangG); bangG.connect(out);
    bangOsc.start(now); bangOsc.stop(now + 0.15);

    // === Layer 2: SUPERSONIC CRACK (high-freq snap) ===
    const noise = ctx.createBufferSource();
    noise.buffer = getNoiseBuffer();
    noise.playbackRate.value = 1.5 + Math.random() * 0.3;
    const crackG = ctx.createGain();
    const crackFilter = ctx.createBiquadFilter();
    crackFilter.type = 'bandpass';
    crackFilter.frequency.setValueAtTime(p.freq, now);
    crackFilter.frequency.exponentialRampToValueAtTime(p.freq * 0.4, now + 0.04);
    crackFilter.Q.value = 1.5;
    crackG.gain.setValueAtTime(0, now);
    crackG.gain.linearRampToValueAtTime(p.crack, now + 0.001);
    crackG.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    noise.connect(crackFilter); crackFilter.connect(crackG); crackG.connect(out);
    noise.start(now); noise.stop(now + 0.06);

    // === Layer 3: BODY (sub-bass thump) ===
    const subOsc = ctx.createOscillator();
    const subG = ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(70, now);
    subOsc.frequency.exponentialRampToValueAtTime(40, now + 0.08);
    subG.gain.setValueAtTime(0.7 * volume, now);
    subG.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    subOsc.connect(subG); subG.connect(out);
    subOsc.start(now); subOsc.stop(now + 0.16);

    // === Layer 4: TAIL/REVERB (environment echo) ===
    if (p.tail > 0.1) {
      const tailNoise = ctx.createBufferSource();
      tailNoise.buffer = getNoiseBuffer();
      tailNoise.playbackRate.value = 0.7;
      const tailG = ctx.createGain();
      const tailFilter = ctx.createBiquadFilter();
      tailFilter.type = 'lowpass';
      tailFilter.frequency.value = 800;
      tailG.gain.setValueAtTime(0, now + 0.04);
      tailG.gain.linearRampToValueAtTime(0.15 * volume, now + 0.06);
      tailG.gain.exponentialRampToValueAtTime(0.001, now + p.tail);
      tailNoise.connect(tailFilter); tailFilter.connect(tailG); tailG.connect(out);
      tailNoise.start(now + 0.04); tailNoise.stop(now + p.tail + 0.05);
    }

    // === Layer 5: MECHANICAL CLINK (bolt/action) ===
    if (type !== 'shotgun1') {
      const clinkOsc = ctx.createOscillator();
      const clinkG = ctx.createGain();
      clinkOsc.type = 'triangle';
      clinkOsc.frequency.value = 3500 + Math.random() * 500;
      clinkG.gain.setValueAtTime(0, now + 0.04);
      clinkG.gain.linearRampToValueAtTime(0.08 * volume, now + 0.045);
      clinkG.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      clinkOsc.connect(clinkG); clinkG.connect(out);
      clinkOsc.start(now + 0.04); clinkOsc.stop(now + 0.09);
    }
  }

  /* ====================================================
     RELOAD — Detailed reload sound sequence
     ==================================================== */
  function playReload() {
    if (!initialized) return;
    const now = ctx.currentTime;
    // Mag release click
    addClick(now, 400, 0.3, 0.04);
    // Mag drop (thud)
    addThud(now + 0.15, 100, 0.4);
    // Mag insert (metallic clack)
    addClick(now + 0.9, 200, 0.4, 0.06);
    addClick(now + 0.92, 600, 0.3, 0.05);
    // Slide/bolt action
    addMetalSlide(now + 1.4);
    addClick(now + 1.7, 800, 0.4, 0.04);
  }

  function addClick(time, freq, vol, dur) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq + Math.random() * 100;
    g.gain.setValueAtTime(vol, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    osc.connect(g); g.connect(sfxGain);
    osc.start(time); osc.stop(time + dur + 0.01);
  }

  function addThud(time, freq, vol) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.5, time + 0.1);
    g.gain.setValueAtTime(vol, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
    osc.connect(g); g.connect(sfxGain);
    osc.start(time); osc.stop(time + 0.16);
  }

  function addMetalSlide(time) {
    const noise = ctx.createBufferSource();
    noise.buffer = getNoiseBuffer();
    noise.playbackRate.value = 0.6;
    const g = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1500;
    filter.Q.value = 3;
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(0.2, time + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.2);
    noise.connect(filter); filter.connect(g); g.connect(sfxGain);
    noise.start(time); noise.stop(time + 0.22);
  }

  function playFootstep(surface = 'concrete', sprint = false) {
    if (!initialized) return;
    const now = ctx.currentTime;
    const noise = ctx.createBufferSource();
    noise.buffer = getNoiseBuffer();
    noise.playbackRate.value = 0.7 + Math.random() * 0.4;
    const g = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';

    const profiles = {
      'concrete': { freq: 800, q: 2, vol: sprint ? 0.18 : 0.12 },
      'grass':    { freq: 350, q: 1.5, vol: sprint ? 0.14 : 0.09 },
      'sand':     { freq: 250, q: 1, vol: sprint ? 0.16 : 0.10 },
      'wood':     { freq: 600, q: 2, vol: sprint ? 0.16 : 0.11 }
    };
    const p = profiles[surface] || profiles.concrete;
    filter.frequency.value = p.freq + Math.random() * 200;
    filter.Q.value = p.q;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(p.vol, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    noise.connect(filter); filter.connect(g); g.connect(sfxGain);
    noise.start(now); noise.stop(now + 0.15);

    // Small thud
    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 80;
    og.gain.setValueAtTime(0.06, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc.connect(og); og.connect(sfxGain);
    osc.start(now); osc.stop(now + 0.07);
  }

  function playImpact(material = 'metal', volume = 1) {
    if (!initialized) return;
    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = volume;
    out.connect(sfxGain);

    if (material === 'metal') {
      // Ricochet ping
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(2500 + Math.random() * 1000, now);
      osc.frequency.exponentialRampToValueAtTime(1500, now + 0.08);
      g.gain.setValueAtTime(0.35, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.connect(g); g.connect(out);
      osc.start(now); osc.stop(now + 0.16);
    } else if (material === 'flesh') {
      // Wet thud
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(80, now + 0.08);
      g.gain.setValueAtTime(0.4, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(g); g.connect(out);
      osc.start(now); osc.stop(now + 0.13);
    } else if (material === 'wood') {
      const noise = ctx.createBufferSource();
      noise.buffer = getNoiseBuffer();
      const g = ctx.createGain();
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 600; f.Q.value = 2;
      g.gain.setValueAtTime(0.3, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      noise.connect(f); f.connect(g); g.connect(out);
      noise.start(now); noise.stop(now + 0.11);
    } else { // concrete/dirt
      const noise = ctx.createBufferSource();
      noise.buffer = getNoiseBuffer();
      const g = ctx.createGain();
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 1500;
      g.gain.setValueAtTime(0.25, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      noise.connect(f); f.connect(g); g.connect(out);
      noise.start(now); noise.stop(now + 0.13);
    }

    // Debris noise
    const debris = ctx.createBufferSource();
    debris.buffer = getNoiseBuffer();
    const dg = ctx.createGain();
    const df = ctx.createBiquadFilter();
    df.type = 'highpass'; df.frequency.value = 1000;
    dg.gain.setValueAtTime(0.1 * volume, now);
    dg.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    debris.connect(df); df.connect(dg); dg.connect(sfxGain);
    debris.start(now); debris.stop(now + 0.12);
  }

  function playExplosion() {
    if (!initialized) return;
    const now = ctx.currentTime;
    // Massive sub-bass
    const sub = ctx.createOscillator();
    const subG = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(50, now);
    sub.frequency.exponentialRampToValueAtTime(20, now + 0.8);
    subG.gain.setValueAtTime(1, now);
    subG.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
    sub.connect(subG); subG.connect(sfxGain);
    sub.start(now); sub.stop(now + 1.3);

    // Mid boom
    const mid = ctx.createOscillator();
    const midG = ctx.createGain();
    mid.type = 'sawtooth';
    mid.frequency.setValueAtTime(180, now);
    mid.frequency.exponentialRampToValueAtTime(50, now + 0.3);
    midG.gain.setValueAtTime(0.7, now);
    midG.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    mid.connect(midG); midG.connect(sfxGain);
    mid.start(now); mid.stop(now + 0.7);

    // Noise blast
    const noise = ctx.createBufferSource();
    noise.buffer = getNoiseBuffer();
    const ng = ctx.createGain();
    const nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.setValueAtTime(3000, now);
    nf.frequency.exponentialRampToValueAtTime(300, now + 1.2);
    ng.gain.setValueAtTime(0.8, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
    noise.connect(nf); nf.connect(ng); ng.connect(sfxGain);
    noise.start(now); noise.stop(now + 1.6);

    // Debris crackle
    for (let i = 0; i < 8; i++) {
      const t = now + 0.1 + Math.random() * 0.6;
      addClick(t, 200 + Math.random() * 400, 0.15, 0.05);
    }
  }

  function playPain() {
    if (!initialized) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200 + Math.random() * 80, now);
    osc.frequency.exponentialRampToValueAtTime(120, now + 0.3);
    g.gain.setValueAtTime(0.35, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc.connect(g); g.connect(sfxGain);
    osc.start(now); osc.stop(now + 0.4);

    // Breath/grunt noise
    const noise = ctx.createBufferSource();
    noise.buffer = getNoiseBuffer();
    const ng = ctx.createGain();
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass'; nf.frequency.value = 400; nf.Q.value = 2;
    ng.gain.setValueAtTime(0.15, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    noise.connect(nf); nf.connect(ng); ng.connect(sfxGain);
    noise.start(now); noise.stop(now + 0.35);
  }

  function playHitmarker(headshot = false) {
    if (!initialized) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = headshot ? 1800 : 1200;
    g.gain.setValueAtTime(0.18, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(g); g.connect(sfxGain);
    osc.start(now); osc.stop(now + 0.09);
    if (headshot) {
      const osc2 = ctx.createOscillator();
      const g2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.value = 2400;
      g2.gain.setValueAtTime(0.12, now + 0.05);
      g2.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
      osc2.connect(g2); g2.connect(sfxGain);
      osc2.start(now + 0.05); osc2.stop(now + 0.14);
    }
  }

  function playClick() {
    if (!initialized) return;
    addClick(ctx.currentTime, 800, 0.12, 0.03);
  }

  function playDryFire() {
    if (!initialized) return;
    const now = ctx.currentTime;
    addClick(now, 1200, 0.25, 0.04);
    addClick(now + 0.05, 800, 0.2, 0.04);
  }

  function playWhizz() {
    // Bullet snap passing near player
    if (!initialized) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(4000, now);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.08);
    g.gain.setValueAtTime(0.2, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(g); g.connect(sfxGain);
    osc.start(now); osc.stop(now + 0.11);
  }

  function playGrenadePin() {
    if (!initialized) return;
    const now = ctx.currentTime;
    addClick(now, 1500, 0.2, 0.05);
    addMetalSlide(now + 0.05);
  }

  function playBeep(freq = 1000) {
    if (!initialized) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.15, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(g); g.connect(sfxGain);
    osc.start(now); osc.stop(now + 0.11);
  }

  return {
    init, resume, setVolume,
    playGunshot, playReload, playFootstep,
    playImpact, playExplosion, playPain, playHitmarker,
    playClick, playDryFire, playWhizz, playGrenadePin, playBeep,
    spatial
  };
})();
