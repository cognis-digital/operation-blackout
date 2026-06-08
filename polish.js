/* ============================================================
   OPERATION BLACKOUT v7 \u2014 POLISH / QUALITY OVERHAUL
   Loaded LAST. Overrides Game.buildWeaponView with much higher-quality
   weapon view models, properly aligned iron sights, real scopes,
   and provides a movement-stuck safety net.
   ============================================================ */
(function () {
  const T = window.THREE;
  if (!window.Game || !T) { console.error('[polish] missing Game or THREE'); return; }

  // ============================================================
  // SHARED MATERIALS (cached, dispose-safe)
  // ============================================================
  const M = {
    polymer:   new T.MeshPhongMaterial({ color: 0x1a1a1a, shininess: 35, specular: 0x222 }),
    polymerDe: new T.MeshPhongMaterial({ color: 0x4a4233, shininess: 30, specular: 0x222 }),
    polymerOd: new T.MeshPhongMaterial({ color: 0x2a3320, shininess: 25, specular: 0x202 }),
    metal:     new T.MeshPhongMaterial({ color: 0x222425, shininess: 80, specular: 0x555 }),
    metalDark: new T.MeshPhongMaterial({ color: 0x111213, shininess: 90, specular: 0x666 }),
    metalGold: new T.MeshPhongMaterial({ color: 0xb8a060, shininess: 120, specular: 0xdca }),
    wood:      new T.MeshPhongMaterial({ color: 0x5a3a18, shininess: 25, specular: 0x331 }),
    woodDark:  new T.MeshPhongMaterial({ color: 0x3a2410, shininess: 20 }),
    rubber:    new T.MeshPhongMaterial({ color: 0x0a0a0a, shininess: 8 }),
    glass:     new T.MeshPhongMaterial({ color: 0x1a2c3a, shininess: 100, opacity: 0.55, transparent: true, specular: 0xaaa }),
    lensRed:   new T.MeshBasicMaterial({ color: 0xff2200, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false }),
    glove:     new T.MeshLambertMaterial({ color: 0x1a1a1a }),
    sleeveUS:  new T.MeshLambertMaterial({ color: 0x3d4a30 })
  };
  // Mark all as shared so disposers leave them alone
  for (const k in M) M[k].__shared = true;

  function pickBodyMat(weapon) {
    if (weapon === WEAPONS.ak47)    return M.wood;
    if (weapon === WEAPONS.scar_h)  return M.polymerDe;
    if (weapon === WEAPONS.mk14)    return M.polymerOd;
    if (weapon === WEAPONS.m24 || weapon === WEAPONS.awp) return M.polymerOd;
    if (weapon === WEAPONS.deagle)  return M.metalGold;
    return M.polymer;
  }

  // ============================================================
  // WEAPON VIEW MODEL (high quality)
  // ============================================================
  function makeWeaponMesh(weapon) {
    const g = new T.Group();
    const isAR     = weapon.class === 'ar';
    const isSniper = weapon.class === 'sniper';
    const isPistol = weapon.class === 'pistol';
    const isSMG    = weapon.class === 'smg';
    const isShot   = weapon.class === 'shotgun';
    const bodyMat  = pickBodyMat(weapon);

    const recvL = (weapon.length || 0.85) * 0.55;
    const recvW = isPistol ? 0.052 : 0.064;
    const recvH = isPistol ? 0.118 : 0.130;
    const SIGHT_Y = recvH * 0.55 + 0.024;

    // ===== RECEIVER =====
    const upper = new T.Mesh(new T.BoxGeometry(recvW, recvH * 0.55, recvL), bodyMat);
    upper.position.set(0, recvH * 0.22, -recvL * 0.1);
    g.add(upper);
    const lower = new T.Mesh(new T.BoxGeometry(recvW * 0.94, recvH * 0.50, recvL * 0.75), bodyMat);
    lower.position.set(0, -recvH * 0.05, -recvL * 0.05);
    g.add(lower);

    // ===== TOP PICATINNY RAIL =====
    if (!isPistol) {
      const rail = new T.Mesh(new T.BoxGeometry(recvW * 0.84, 0.013, recvL * 0.96), M.metalDark);
      rail.position.set(0, recvH * 0.52, -recvL * 0.1);
      g.add(rail);
      for (let i = -4; i <= 4; i++) {
        const slot = new T.Mesh(new T.BoxGeometry(recvW * 0.92, 0.006, 0.008), M.metal);
        slot.position.set(0, recvH * 0.541, -recvL * 0.1 + i * 0.045);
        g.add(slot);
      }
    }

    // ===== BARREL =====
    const barrelLen = weapon.barrelLen || 0.4;
    const barrelR = isSniper ? 0.024 : (isPistol ? 0.013 : 0.018);
    const barrel = new T.Mesh(new T.CylinderGeometry(barrelR, barrelR, barrelLen, 14), M.metalDark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, recvH * 0.10, -recvL * 0.4 - barrelLen * 0.5);
    g.add(barrel);
    // Gas block on rifles
    if (isAR && !isSniper) {
      const gb = new T.Mesh(new T.BoxGeometry(0.030, 0.040, 0.045), M.metalDark);
      gb.position.set(0, recvH * 0.14, -recvL * 0.4 - barrelLen * 0.7);
      g.add(gb);
    }

    // ===== HANDGUARD =====
    if (isAR || isSMG) {
      const hgMat = bodyMat === M.wood ? M.wood : M.metalDark;
      const hg = new T.Mesh(new T.CylinderGeometry(recvW * 0.65, recvW * 0.65, barrelLen * 0.85, 8), hgMat);
      hg.rotation.x = Math.PI / 2;
      hg.position.set(0, recvH * 0.10, -recvL * 0.4 - barrelLen * 0.42);
      g.add(hg);
      // M-LOK slots (side cutouts)
      for (let i = 0; i < 4; i++) {
        const slot = new T.Mesh(new T.BoxGeometry(0.005, 0.022, 0.040), M.metal);
        slot.position.set(recvW * 0.62, recvH * 0.10, -recvL * 0.4 - barrelLen * 0.25 - i * 0.07);
        g.add(slot);
        const slot2 = slot.clone(); slot2.position.x = -recvW * 0.62; g.add(slot2);
      }
    } else if (isShot) {
      const fe = new T.Mesh(new T.BoxGeometry(recvW * 1.5, recvH * 0.55, barrelLen * 0.55), M.wood);
      fe.position.set(0, -recvH * 0.05, -recvL * 0.4 - barrelLen * 0.35);
      g.add(fe);
    }

    // ===== MUZZLE DEVICE =====
    let muzzleZ = -recvL * 0.4 - barrelLen - 0.02;
    if (isSniper) {
      const brake = new T.Mesh(new T.CylinderGeometry(0.035, 0.038, 0.12, 10), M.metalDark);
      brake.rotation.x = Math.PI / 2;
      brake.position.set(0, recvH * 0.10, muzzleZ - 0.06);
      g.add(brake);
      for (let i = 0; i < 3; i++) {
        const cut = new T.Mesh(new T.BoxGeometry(0.085, 0.012, 0.012), M.metal);
        cut.position.set(0, recvH * 0.10 + 0.025, muzzleZ - 0.035 - i * 0.025);
        g.add(cut);
      }
      muzzleZ -= 0.12;
    } else if (isAR || isSMG) {
      const fh = new T.Mesh(new T.CylinderGeometry(0.025, 0.025, 0.07, 10), M.metalDark);
      fh.rotation.x = Math.PI / 2;
      fh.position.set(0, recvH * 0.10, muzzleZ - 0.035);
      g.add(fh);
      // Prong cuts (visual)
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const prong = new T.Mesh(new T.BoxGeometry(0.005, 0.005, 0.025), M.metal);
        prong.position.set(Math.cos(a) * 0.024, recvH * 0.10 + Math.sin(a) * 0.024, muzzleZ - 0.045);
        g.add(prong);
      }
      muzzleZ -= 0.07;
    } else if (isShot) {
      const choke = new T.Mesh(new T.CylinderGeometry(0.030, 0.035, 0.05, 12), M.metalDark);
      choke.rotation.x = Math.PI / 2;
      choke.position.set(0, recvH * 0.10, muzzleZ - 0.025);
      g.add(choke);
      muzzleZ -= 0.05;
    } else {
      muzzleZ -= 0.02;
    }
    g.userData.muzzleZ = muzzleZ;

    // ===== IRON SIGHTS \u2014 perfectly aligned on weapon's local X=0, Y=SIGHT_Y =====
    if (!isPistol && !isSniper) {
      // Rear aperture
      const rearBase = new T.Mesh(new T.BoxGeometry(0.025, 0.018, 0.025), M.metalDark);
      rearBase.position.set(0, SIGHT_Y - 0.012, recvL * 0.35);
      g.add(rearBase);
      const rwL = new T.Mesh(new T.BoxGeometry(0.005, 0.028, 0.020), M.metalDark);
      rwL.position.set(-0.012, SIGHT_Y, recvL * 0.35);
      g.add(rwL);
      const rwR = rwL.clone(); rwR.position.x = 0.012; g.add(rwR);
      // Aperture ring (just a thin torus for visual)
      const apRing = new T.Mesh(new T.TorusGeometry(0.005, 0.0015, 4, 10), M.metal);
      apRing.position.set(0, SIGHT_Y, recvL * 0.35);
      apRing.rotation.y = Math.PI / 2;
      g.add(apRing);
      // Front post
      const fsBase = new T.Mesh(new T.BoxGeometry(0.030, 0.020, 0.035), M.metalDark);
      fsBase.position.set(0, SIGHT_Y - 0.014, -recvL * 0.35 - barrelLen * 0.85);
      g.add(fsBase);
      const fsPost = new T.Mesh(new T.BoxGeometry(0.005, 0.030, 0.005), M.metal);
      fsPost.position.set(0, SIGHT_Y - 0.001, -recvL * 0.35 - barrelLen * 0.85);
      g.add(fsPost);
      const fwL = new T.Mesh(new T.BoxGeometry(0.005, 0.032, 0.020), M.metalDark);
      fwL.position.set(-0.013, SIGHT_Y - 0.001, -recvL * 0.35 - barrelLen * 0.85);
      g.add(fwL);
      const fwR = fwL.clone(); fwR.position.x = 0.013; g.add(fwR);
    }

    // ===== PISTOL IRON SIGHTS =====
    if (isPistol) {
      const rL = new T.Mesh(new T.BoxGeometry(0.014, 0.016, 0.012), M.metal);
      rL.position.set(-0.012, recvH * 0.63, recvL * 0.18);
      g.add(rL);
      const rR = rL.clone(); rR.position.x = 0.012; g.add(rR);
      const front = new T.Mesh(new T.BoxGeometry(0.005, 0.016, 0.008), M.metal);
      front.position.set(0, recvH * 0.62, -recvL * 0.22);
      g.add(front);
      // Sight dots (luminous tritium look)
      const dotMat = new T.MeshBasicMaterial({ color: 0x88ff88 });
      const dotL = new T.Mesh(new T.SphereGeometry(0.0025, 6, 4), dotMat);
      dotL.position.set(-0.012, recvH * 0.635, recvL * 0.185); g.add(dotL);
      const dotR = dotL.clone(); dotR.position.x = 0.012; g.add(dotR);
      const dotF = dotL.clone(); dotF.position.set(0, recvH * 0.625, -recvL * 0.215); g.add(dotF);
    }

    // ===== OPTIC =====
    if (isSniper) {
      const scopeMain = new T.Mesh(new T.CylinderGeometry(0.038, 0.038, 0.32, 18), M.metalDark);
      scopeMain.rotation.x = Math.PI / 2;
      scopeMain.position.set(0, SIGHT_Y + 0.030, -recvL * 0.05);
      g.add(scopeMain);
      const obj = new T.Mesh(new T.CylinderGeometry(0.055, 0.055, 0.07, 18), M.metalDark);
      obj.rotation.x = Math.PI / 2;
      obj.position.set(0, SIGHT_Y + 0.030, -recvL * 0.05 - 0.18);
      g.add(obj);
      // Sunshade
      const sun = new T.Mesh(new T.CylinderGeometry(0.057, 0.057, 0.06, 18), M.metalDark);
      sun.rotation.x = Math.PI / 2;
      sun.position.set(0, SIGHT_Y + 0.030, -recvL * 0.05 - 0.24);
      g.add(sun);
      // Objective lens (front glass)
      const objLens = new T.Mesh(new T.CircleGeometry(0.050, 18), M.glass);
      objLens.position.set(0, SIGHT_Y + 0.030, -recvL * 0.05 - 0.215);
      objLens.lookAt(0, SIGHT_Y + 0.030, -recvL * 0.05 - 5);
      g.add(objLens);
      // Eyepiece
      const ep = new T.Mesh(new T.CylinderGeometry(0.045, 0.045, 0.07, 18), M.metalDark);
      ep.rotation.x = Math.PI / 2;
      ep.position.set(0, SIGHT_Y + 0.030, -recvL * 0.05 + 0.18);
      g.add(ep);
      const epRubber = new T.Mesh(new T.CylinderGeometry(0.050, 0.050, 0.025, 18), M.rubber);
      epRubber.rotation.x = Math.PI / 2;
      epRubber.position.set(0, SIGHT_Y + 0.030, -recvL * 0.05 + 0.22);
      g.add(epRubber);
      // Turrets
      const elv = new T.Mesh(new T.CylinderGeometry(0.025, 0.025, 0.04, 12), M.metalDark);
      elv.position.set(0, SIGHT_Y + 0.083, -recvL * 0.05);
      g.add(elv);
      const win = new T.Mesh(new T.CylinderGeometry(0.025, 0.025, 0.04, 12), M.metalDark);
      win.rotation.z = Math.PI / 2;
      win.position.set(0.043, SIGHT_Y + 0.030, -recvL * 0.05);
      g.add(win);
      // Parallax adjustment knob (left side)
      const par = new T.Mesh(new T.CylinderGeometry(0.025, 0.025, 0.03, 12), M.metalDark);
      par.rotation.z = Math.PI / 2;
      par.position.set(-0.043, SIGHT_Y + 0.030, -recvL * 0.10);
      g.add(par);
      // Mounting rings
      const ring1 = new T.Mesh(new T.TorusGeometry(0.040, 0.005, 6, 14), M.metal);
      ring1.rotation.y = Math.PI / 2;
      ring1.position.set(0, SIGHT_Y + 0.030, -recvL * 0.05 - 0.10);
      g.add(ring1);
      const ring2 = ring1.clone(); ring2.position.z = -recvL * 0.05 + 0.10; g.add(ring2);
    } else if (!isPistol) {
      // ACOG-style optic for HK416/MK14, red-dot for others
      const isAcog = (weapon === WEAPONS.hk416 || weapon === WEAPONS.scar_h);
      if (isAcog) {
        // ACOG body (tube with magnification)
        const acogBody = new T.Mesh(new T.CylinderGeometry(0.026, 0.030, 0.16, 14), M.metalDark);
        acogBody.rotation.x = Math.PI / 2;
        acogBody.position.set(0, SIGHT_Y + 0.040, -recvL * 0.05);
        g.add(acogBody);
        const acogFront = new T.Mesh(new T.CylinderGeometry(0.024, 0.024, 0.03, 14), M.metalDark);
        acogFront.rotation.x = Math.PI / 2;
        acogFront.position.set(0, SIGHT_Y + 0.040, -recvL * 0.05 - 0.095);
        g.add(acogFront);
        const acogBack = new T.Mesh(new T.CylinderGeometry(0.028, 0.028, 0.02, 14), M.rubber);
        acogBack.rotation.x = Math.PI / 2;
        acogBack.position.set(0, SIGHT_Y + 0.040, -recvL * 0.05 + 0.09);
        g.add(acogBack);
        // Mounting base
        const mount = new T.Mesh(new T.BoxGeometry(0.055, 0.020, 0.10), M.metalDark);
        mount.position.set(0, SIGHT_Y + 0.014, -recvL * 0.05);
        g.add(mount);
        // Reticle (chevron) \u2014 glowing red triangle
        const ret = new T.Mesh(new T.CircleGeometry(0.006, 12), M.lensRed.clone());
        ret.position.set(0, SIGHT_Y + 0.040, -recvL * 0.05 - 0.110);
        ret.renderOrder = 999;
        ret.visible = false;
        g.add(ret);
        g.userData.reticle = ret;
      } else {
        // Red-dot
        const mount = new T.Mesh(new T.BoxGeometry(0.055, 0.020, 0.10), M.metalDark);
        mount.position.set(0, SIGHT_Y + 0.012, -recvL * 0.05);
        g.add(mount);
        const body = new T.Mesh(new T.BoxGeometry(0.055, 0.070, 0.085), M.metalDark);
        body.position.set(0, SIGHT_Y + 0.056, -recvL * 0.05);
        g.add(body);
        // Glass (tilted forward like real reflex sight)
        const lens = new T.Mesh(new T.PlaneGeometry(0.045, 0.055), M.glass);
        lens.position.set(0, SIGHT_Y + 0.056, -recvL * 0.05 - 0.043);
        lens.rotation.y = 0.18;
        g.add(lens);
        // Red dot
        const dot = new T.Mesh(new T.CircleGeometry(0.0045, 14), M.lensRed.clone());
        dot.position.set(0, SIGHT_Y + 0.056, -recvL * 0.05 - 0.044);
        dot.renderOrder = 999;
        dot.visible = false;
        g.add(dot);
        g.userData.reticle = dot;
        // Adjustment knob
        const knob = new T.Mesh(new T.CylinderGeometry(0.010, 0.010, 0.018, 8), M.metal);
        knob.rotation.z = Math.PI / 2;
        knob.position.set(0.030, SIGHT_Y + 0.056, -recvL * 0.05);
        g.add(knob);
      }
    }

    // ===== MAGAZINE =====
    if (!isShot) {
      const magW = isPistol ? 0.038 : 0.062;
      const magH = isPistol ? 0.12 : (weapon.magSize > 30 ? 0.22 : 0.16);
      const magD = isPistol ? 0.045 : 0.075;
      const isCurved = weapon === WEAPONS.ak47 || weapon === WEAPONS.scar_h || weapon === WEAPONS.mk14;
      if (weapon === WEAPONS.p90) {
        const pmag = new T.Mesh(new T.BoxGeometry(0.07, 0.038, 0.30), M.polymer);
        pmag.position.set(0, recvH * 0.42, -recvL * 0.10);
        g.add(pmag);
      } else {
        const magMat = isCurved ? M.metalDark : M.polymer;
        const mag = new T.Mesh(new T.BoxGeometry(magW, magH, magD), magMat);
        mag.position.set(0, -magH * 0.5 - recvH * 0.20, 0.02);
        if (isCurved) mag.rotation.x = 0.20;
        g.add(mag);
        const fp = new T.Mesh(new T.BoxGeometry(magW + 0.005, 0.012, magD + 0.005), M.metal);
        fp.position.set(mag.position.x, mag.position.y - magH * 0.5 - 0.006, mag.position.z);
        if (isCurved) fp.rotation.x = mag.rotation.x;
        g.add(fp);
      }
    }

    // ===== STOCK =====
    if (!isPistol) {
      if (isSniper) {
        const sBody = new T.Mesh(new T.BoxGeometry(0.065, 0.12, 0.36), M.woodDark);
        sBody.position.set(0, -0.01, recvL * 0.50);
        g.add(sBody);
        const cheek = new T.Mesh(new T.BoxGeometry(0.075, 0.06, 0.16), M.woodDark);
        cheek.position.set(0, 0.06, recvL * 0.40);
        g.add(cheek);
        const buttPad = new T.Mesh(new T.BoxGeometry(0.075, 0.14, 0.025), M.rubber);
        buttPad.position.set(0, -0.01, recvL * 0.69);
        g.add(buttPad);
      } else if (isShot) {
        const sBody = new T.Mesh(new T.BoxGeometry(0.065, 0.10, 0.30), M.wood);
        sBody.position.set(0, 0, recvL * 0.45);
        g.add(sBody);
        const buttPad = new T.Mesh(new T.BoxGeometry(0.07, 0.14, 0.025), M.rubber);
        buttPad.position.set(0, 0, recvL * 0.62);
        g.add(buttPad);
        const pump = new T.Mesh(new T.BoxGeometry(0.080, 0.060, 0.12), M.wood);
        pump.position.set(0, -recvH * 0.20, -recvL * 0.4 - barrelLen * 0.30);
        g.add(pump);
      } else {
        // Collapsible adjustable stock
        const tube = new T.Mesh(new T.CylinderGeometry(0.022, 0.022, 0.22, 8), M.metalDark);
        tube.rotation.x = Math.PI / 2;
        tube.position.set(0, recvH * 0.08, recvL * 0.36);
        g.add(tube);
        const stockBody = new T.Mesh(new T.BoxGeometry(0.055, 0.11, 0.18), M.polymer);
        stockBody.position.set(0, recvH * 0.05, recvL * 0.46);
        g.add(stockBody);
        const cheek = new T.Mesh(new T.BoxGeometry(0.055, 0.040, 0.10), M.polymer);
        cheek.position.set(0, recvH * 0.135, recvL * 0.45);
        g.add(cheek);
        const buttPad = new T.Mesh(new T.BoxGeometry(0.06, 0.13, 0.022), M.rubber);
        buttPad.position.set(0, recvH * 0.05, recvL * 0.55);
        g.add(buttPad);
      }
    } else {
      // Pistol slide
      const slide = new T.Mesh(new T.BoxGeometry(recvW * 1.05, recvH * 0.45, recvL * 0.85), M.metalDark);
      slide.position.set(0, recvH * 0.40, -recvL * 0.05);
      g.add(slide);
      for (let i = 0; i < 7; i++) {
        const serr = new T.Mesh(new T.BoxGeometry(recvW * 1.06, recvH * 0.42, 0.004), M.metal);
        serr.position.set(0, recvH * 0.40, recvL * 0.18 + i * 0.012);
        g.add(serr);
      }
    }

    // ===== PISTOL GRIP =====
    const gripGeo = isPistol
      ? new T.BoxGeometry(0.048, 0.18, 0.058)
      : new T.BoxGeometry(0.048, 0.14, 0.048);
    const grip = new T.Mesh(gripGeo, M.polymer);
    grip.position.set(0, isPistol ? -0.11 : -0.10, isPistol ? 0.02 : 0.10);
    grip.rotation.x = isPistol ? 0 : 0.25;
    g.add(grip);

    // ===== FOREGRIP (vertical grip on ARs/SMGs) =====
    if ((isAR || isSMG) && (weapon === WEAPONS.m4a1 || weapon === WEAPONS.hk416 || weapon === WEAPONS.mp5 || weapon === WEAPONS.scar_h)) {
      const vg = new T.Mesh(new T.CylinderGeometry(0.018, 0.022, 0.10, 10), M.polymer);
      vg.position.set(0, -0.08, -recvL * 0.35 - barrelLen * 0.40);
      g.add(vg);
    }

    // ===== TRIGGER + GUARD =====
    const tg = new T.Mesh(new T.TorusGeometry(0.028, 0.005, 5, 10, Math.PI * 1.3), M.metal);
    tg.position.set(0, -0.045, 0.06);
    tg.rotation.x = Math.PI / 2;
    g.add(tg);
    const trigger = new T.Mesh(new T.BoxGeometry(0.005, 0.025, 0.012), M.metal);
    trigger.position.set(0, -0.035, 0.055);
    g.add(trigger);

    // ===== CHARGING HANDLE =====
    if (!isPistol && !isShot) {
      const ch = new T.Mesh(new T.BoxGeometry(0.012, 0.020, 0.06), M.metalDark);
      ch.position.set(-recvW * 0.55, recvH * 0.18, recvL * 0.20);
      g.add(ch);
    }

    // ===== HANDS =====
    const handsGroup = new T.Group();
    const rHand = new T.Mesh(new T.BoxGeometry(0.09, 0.10, 0.10), M.glove);
    rHand.position.set(0, -0.10, isPistol ? 0.03 : 0.10);
    handsGroup.add(rHand);
    const rSleeve = new T.Mesh(new T.BoxGeometry(0.090, 0.075, 0.20), M.sleeveUS);
    rSleeve.position.set(0.05, -0.13, 0.20);
    rSleeve.rotation.z = 0.35;
    handsGroup.add(rSleeve);
    if (!isPistol) {
      const lHand = new T.Mesh(new T.BoxGeometry(0.09, 0.10, 0.11), M.glove);
      lHand.position.set(0, -0.08, -recvL * 0.35 - barrelLen * 0.40);
      handsGroup.add(lHand);
      const lSleeve = new T.Mesh(new T.BoxGeometry(0.09, 0.085, 0.22), M.sleeveUS);
      lSleeve.position.set(0.02, -0.16, -recvL * 0.20);
      lSleeve.rotation.z = -0.25;
      lSleeve.rotation.x = 0.5;
      handsGroup.add(lSleeve);
    }
    g.add(handsGroup);
    g.userData.handsGroup = handsGroup;
    g.userData.__polished = true;  // marker so we don't re-replace
    return g;
  }

  // ============================================================
  // INSTALL OVERRIDE OF Game.buildWeaponView
  // We replace the function on the Game object so any future calls
  // (initial mission start, weapon switch) build OUR mesh.
  // ============================================================
  const originalBuild = Game.buildWeaponView;
  Game.buildWeaponView = function (weapon) {
    if (!weapon) return originalBuild && originalBuild(weapon);
    const camera = Game.getCamera && Game.getCamera();
    if (!camera) return originalBuild && originalBuild(weapon);

    // Remove old weapon mesh from camera
    const oldMesh = Game.getWeaponMesh && Game.getWeaponMesh();
    if (oldMesh) {
      camera.remove(oldMesh);
      oldMesh.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && !o.material.__shared) o.material.dispose();
      });
    }

    // Build & install new high-quality mesh
    const mesh = makeWeaponMesh(weapon);
    mesh.position.set(0.24, -0.20, -0.50);
    mesh.rotation.y = -0.05;
    mesh.rotation.x = 0.02;
    camera.add(mesh);
    // Ensure camera is in the scene
    const scene = Game.getScene && Game.getScene();
    if (scene && !scene.children.includes(camera)) scene.add(camera);
    Game.setWeaponMesh && Game.setWeaponMesh(mesh);
    console.log('[polish] built v7 mesh for', weapon.name);
    return mesh;
  };

  // ============================================================
  // PER-FRAME TICK: reticle visibility + hide hands when scoped
  // ============================================================
  function tick() {
    requestAnimationFrame(tick);
    const p = Game.getPlayer && Game.getPlayer();
    const mesh = Game.getWeaponMesh && Game.getWeaponMesh();
    if (!p || !mesh || !mesh.userData.__polished) return;
    const w = Game.currentWeapon && Game.currentWeapon();
    // Reticle: visible only when ADS, not reloading, not drawing
    if (mesh.userData.reticle) {
      mesh.userData.reticle.visible = !!p.ads && !p.reloading && !p.drawing;
    }
    // Hide hands when looking through a true scope
    if (mesh.userData.handsGroup && w) {
      mesh.userData.handsGroup.visible = !(p.ads && w.scoped);
    }
  }
  tick();

  // ============================================================
  // MOVEMENT-STUCK SAFETY NET
  // ============================================================
  // ===== MOVEMENT WATCHDOG (gentler version) =====
  // v9: only trigger if player has been COMPLETELY frozen (zero motion) while
  // holding WASD for 4+ seconds AND not in mid-air. Then nudge sideways instead
  // of upward (no more random bounces).
  let lastPos = null;
  let stuckCount = 0;
  setInterval(() => {
    const p = Game.getPlayer && Game.getPlayer();
    const ms = Game.getMissionState && Game.getMissionState();
    const keys = Game.getKeys && Game.getKeys();
    if (!p || !ms || !keys) return;
    if (ms.paused || ms.ended || p.dead || !p.onGround) {
      stuckCount = 0; lastPos = null; return;
    }
    const tryingMove = keys['KeyW'] || keys['KeyA'] || keys['KeyS'] || keys['KeyD'];
    if (!tryingMove) { stuckCount = 0; lastPos = null; return; }
    if (lastPos) {
      const dx = p.position.x - lastPos.x;
      const dz = p.position.z - lastPos.z;
      // Stricter "stuck" threshold: <1cm of total motion over the interval
      if (dx * dx + dz * dz < 0.0001) {
        stuckCount++;
        if (stuckCount > 16) {  // 16 * 250ms = 4 seconds frozen
          // Try a small SIDEWAYS nudge (not up) in random direction
          const ang = Math.random() * Math.PI * 2;
          p.position.x += Math.cos(ang) * 0.6;
          p.position.z += Math.sin(ang) * 0.6;
          stuckCount = 0;
          console.log('[polish] sideways-unstuck player');
        }
      } else { stuckCount = 0; }
    }
    lastPos = { x: p.position.x, z: p.position.z };
  }, 250);

  console.log('[polish] v7 quality overhaul loaded');
})();
