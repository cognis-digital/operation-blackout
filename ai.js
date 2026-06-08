/* ============================================================
   AI v3 — Detailed models + EFFICIENT hitboxes (no mesh raycasts)
   ============================================================ */

// REBALANCED: longer reaction times, lower base accuracy, distance falloff handled in tryShoot.
const AI_DIFFICULTY = {
  recruit:  { aim: 0.30, reaction: 1.6,  fov: 80,  range: 45, accuracy: 0.35, hp: 80,  dmgMult: 0.55, firstShotDelay: 0.8 },
  regular:  { aim: 0.50, reaction: 1.1,  fov: 100, range: 60, accuracy: 0.50, hp: 100, dmgMult: 0.75, firstShotDelay: 0.55 },
  veteran:  { aim: 0.70, reaction: 0.65, fov: 120, range: 75, accuracy: 0.65, hp: 120, dmgMult: 0.95, firstShotDelay: 0.35 },
  elite:    { aim: 0.85, reaction: 0.35, fov: 140, range: 95, accuracy: 0.82, hp: 140, dmgMult: 1.15, firstShotDelay: 0.20 }
};

// Shared temp vectors (avoid allocation in hot loops)
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

// ===== GLOBAL ENGAGEMENT COORDINATOR =====
// Only ONE enemy may have the "active shooter" lock on the player at a time.
// Other AI that can see the player will SUPPORT (suppress at lower rate) or hold cover.
// Lock rotates every ~4 seconds, or if active shooter is killed/loses target.
const Engagement = {
  activeShooterId: null,
  lockTime: 0,
  lockDuration: 4.0,
  reset() { this.activeShooterId = null; this.lockTime = 0; },
  tick(dt, world, player) {
    this.lockTime += dt;
    const active = world.enemies.find(e => e.id === this.activeShooterId);
    const activeValid = active && !active.dead && active.target === player
                       && active.canSeeTarget(player, world);
    if (!activeValid || this.lockTime >= this.lockDuration) {
      // Pick a new active shooter from enemies who can see the player
      const candidates = world.enemies.filter(e => !e.dead
        && e.target === player
        && e.canSeeTarget(player, world));
      if (candidates.length > 0) {
        // Prefer closest with LOS
        candidates.sort((a, b) => {
          const da = (a.position.x-player.position.x)**2 + (a.position.z-player.position.z)**2;
          const db = (b.position.x-player.position.x)**2 + (b.position.z-player.position.z)**2;
          return da - db;
        });
        this.activeShooterId = candidates[0].id;
        this.lockTime = 0;
      } else {
        this.activeShooterId = null;
      }
    }
  },
  isActive(ai) {
    return ai.id === this.activeShooterId;
  }
};
if (typeof window !== 'undefined') window.Engagement = Engagement;

class AISoldier {
  constructor(opts) {
    this.id = opts.id;
    this.faction = opts.faction || 'enemy';
    this.position = opts.position.clone();
    this.spawnPos = opts.position.clone();
    this.rotation = 0;
    this.targetRotation = 0;
    this.velocity = new THREE.Vector3();
    this.walkPhase = 0;

    this.difficulty = opts.difficulty || 'regular';
    this.behavior = opts.behavior || 'balanced';
    const cfg = AI_DIFFICULTY[this.difficulty];

    this.maxHealth = cfg.hp;
    this.health = this.maxHealth;
    this.armor = this.faction === 'friendly' ? 75 : 40;
    this.maxArmor = this.armor;

    // PER-SOLDIER variance: ±15% so two "regulars" are noticeably different
    const variance = () => 0.85 + Math.random() * 0.30;
    this.fov = cfg.fov * (0.9 + Math.random() * 0.2);
    this.viewRange = cfg.range * variance();
    this.aim = cfg.aim * variance();
    this.accuracy = Math.min(0.92, cfg.accuracy * variance());
    this.dmgMult = cfg.dmgMult * variance();
    this.reactionTime = cfg.reaction * (0.85 + Math.random() * 0.35);
    this.firstShotDelay = cfg.firstShotDelay * (0.8 + Math.random() * 0.5);
    // Per-soldier preferred engagement range (some prefer close, some long)
    this.preferredRange = 8 + Math.random() * 25;
    // Engagement settle timer: shots become more accurate as the AI tracks you (max ~2s)
    this.targetTrackTime = 0;
    this.lastTargetId = null;
    // Stance: idle / crouched / prone
    this.stance = 'stand';
    this.stanceChangeTime = 0;
    // Burst control: AI fires bursts, then pauses (reduces sustained DPS)
    this.burstShotsLeft = 0;
    this.burstCooldown = 0;

    this.name = randomSoldierName(this.faction);
    this.rank = this.faction === 'friendly' ? RANKS[Math.floor(Math.random()*5)] : null;

    const weaponKeys = this.faction === 'enemy'
      ? ['ak47','m4a1','mp5','m870','ak47','m4a1']
      : ['m4a1','hk416','mk14'];
    this.weapon = WEAPONS[weaponKeys[Math.floor(Math.random()*weaponKeys.length)]];
    this.ammo = this.weapon.magSize;
    this.reserveAmmo = this.weapon.reserve;
    this.lastShot = 0;
    this.reloading = false;
    this.reloadEnd = 0;

    this.state = 'PATROL';
    this.target = null;
    this.lastSawTarget = 0;
    this.lastKnownPos = null;
    this.alertLevel = 0;
    this.reactionTimer = 0;
    this.stateTimer = 0;
    this.coverPos = null;
    this.flankPos = null;
    this.patrolTarget = null;
    this.suppressTimer = 0;
    this.engageTimer = 0;
    this.lastDamageDir = null;

    this.shotsFired = 0;
    this.hits = 0;
    this.killer = null;

    this.bodyDamage = { head: 0, torso: 0, larm: 0, rarm: 0, lleg: 0, rleg: 0 };
    this.bleeding = 0;

    this.mesh = this.buildMesh();
    this.mesh.position.copy(this.position);
    this.dead = false;
    this.deadTime = 0;

    this.walkSpeed = 2.5;
    this.runSpeed = 5.5;
    this.lastFootstep = 0;

    // ===== PRE-COMPUTED HITBOXES (much faster than mesh raycast) =====
    // Each hitbox is { ofsX, ofsY, ofsZ, w, h, d, part, mult }
    // Coords are RELATIVE to soldier position
    this.hitboxes = [
      { ofsY: 1.85, w: 0.30, h: 0.30, d: 0.30, part: 'head', mult: 2.5 },     // Head + helmet
      { ofsY: 1.25, w: 0.60, h: 0.75, d: 0.40, part: 'torso', mult: 1.0 },    // Torso + vest
      { ofsY: 0.75, w: 0.50, h: 0.20, d: 0.35, part: 'torso', mult: 0.9 },    // Hips
      { ofsX: -0.30, ofsY: 1.25, w: 0.18, h: 0.75, d: 0.18, part: 'larm', mult: 0.7 },
      { ofsX: 0.30, ofsY: 1.25, w: 0.18, h: 0.75, d: 0.18, part: 'rarm', mult: 0.7 },
      { ofsX: -0.13, ofsY: 0.40, w: 0.22, h: 0.85, d: 0.25, part: 'lleg', mult: 0.8 },
      { ofsX: 0.13, ofsY: 0.40, w: 0.22, h: 0.85, d: 0.25, part: 'rleg', mult: 0.8 }
    ];
  }

  buildMesh() {
    const group = new THREE.Group();
    const isEnemy = this.faction === 'enemy';

    const uniformColor = isEnemy ? 0x4a3a25 : 0x3d4a30;
    const uniformDark = isEnemy ? 0x3a2a18 : 0x2d3a22;
    const vestColor = isEnemy ? 0x2a1f15 : 0x303a25;
    const skinColor = isEnemy ? 0xb8927a : 0xc09a82;
    const bootColor = 0x1a1a1a;
    const glovesColor = 0x2a2a2a;
    const helmetColor = isEnemy ? 0x3a2a18 : 0x4a5a3a;

    const uniformMat = new THREE.MeshLambertMaterial({ color: uniformColor });
    const uniformDarkMat = new THREE.MeshLambertMaterial({ color: uniformDark });
    const vestMat = new THREE.MeshLambertMaterial({ color: vestColor });
    const skinMat = new THREE.MeshLambertMaterial({ color: skinColor });
    const bootMat = new THREE.MeshLambertMaterial({ color: bootColor });
    const glovesMat = new THREE.MeshLambertMaterial({ color: glovesColor });
    const helmetMat = new THREE.MeshPhongMaterial({ color: helmetColor, shininess: 5 });
    const metalMat = new THREE.MeshPhongMaterial({ color: 0x222222, shininess: 60 });

    // Lower torso
    const lowerTorso = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.35, 0.32), uniformMat);
    lowerTorso.position.y = 1.05;
    lowerTorso.castShadow = true;
    group.add(lowerTorso);

    // Chest
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.35, 0.34), uniformMat);
    chest.position.y = 1.40;
    chest.castShadow = true;
    group.add(chest);

    // Plate carrier front & back
    const vestFront = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.55, 0.08), vestMat);
    vestFront.position.set(0, 1.25, 0.21);
    vestFront.castShadow = true;
    group.add(vestFront);
    const vestBack = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.55, 0.08), vestMat);
    vestBack.position.set(0, 1.25, -0.21);
    group.add(vestBack);

    // Mag pouches (single geom, merged would be better but quick)
    for (let i = -1; i <= 1; i++) {
      const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.16, 0.07), uniformDarkMat);
      pouch.position.set(i * 0.16, 1.10, 0.27);
      group.add(pouch);
    }

    // Neck
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.12, 6), skinMat);
    neck.position.y = 1.65;
    group.add(neck);

    // Head
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.25, 0.22), skinMat);
    head.position.y = 1.80;
    head.castShadow = true;
    group.add(head);

    // Eyes
    const eyeGeo = new THREE.BoxGeometry(0.04, 0.025, 0.01);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000 });
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.05, 1.83, 0.11);
    group.add(eyeL);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeR.position.set(0.05, 1.83, 0.11);
    group.add(eyeR);

    // Helmet
    const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.16, 0.27), helmetMat);
    helmet.position.y = 1.95;
    helmet.castShadow = true;
    group.add(helmet);
    const helmetRim = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.28), helmetMat);
    helmetRim.position.y = 1.88;
    group.add(helmetRim);
    // NVG mount
    const nvg = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.04, 0.05), metalMat);
    nvg.position.set(0, 2.04, 0.10);
    nvg.rotation.x = -0.5;
    group.add(nvg);

    // Shoulders
    const shoulderGeo = new THREE.SphereGeometry(0.11, 6, 4);
    const shoulderL = new THREE.Mesh(shoulderGeo, uniformMat);
    shoulderL.position.set(-0.31, 1.52, 0);
    shoulderL.castShadow = true;
    group.add(shoulderL);
    const shoulderR = new THREE.Mesh(shoulderGeo, uniformMat);
    shoulderR.position.set(0.31, 1.52, 0);
    shoulderR.castShadow = true;
    group.add(shoulderR);

    // Left arm (jointed)
    const leftArmGroup = new THREE.Group();
    leftArmGroup.position.set(-0.31, 1.50, 0);
    const upperArmL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.35, 0.13), uniformMat);
    upperArmL.position.y = -0.17;
    upperArmL.castShadow = true;
    leftArmGroup.add(upperArmL);
    const forearmL = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.33, 0.11), uniformMat);
    forearmL.position.y = -0.50;
    leftArmGroup.add(forearmL);
    const handL = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.10, 0.10), glovesMat);
    handL.position.y = -0.71;
    leftArmGroup.add(handL);
    group.add(leftArmGroup);
    this.leftArm = leftArmGroup;

    // Right arm
    const rightArmGroup = new THREE.Group();
    rightArmGroup.position.set(0.31, 1.50, 0);
    const upperArmR = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.35, 0.13), uniformMat);
    upperArmR.position.y = -0.17;
    upperArmR.castShadow = true;
    rightArmGroup.add(upperArmR);
    const forearmR = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.33, 0.11), uniformMat);
    forearmR.position.y = -0.50;
    rightArmGroup.add(forearmR);
    const handR = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.10, 0.10), glovesMat);
    handR.position.y = -0.71;
    rightArmGroup.add(handR);
    group.add(rightArmGroup);
    this.rightArm = rightArmGroup;

    // Hips & belt
    const hips = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.15, 0.30), uniformDarkMat);
    hips.position.y = 0.83;
    group.add(hips);
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.05, 0.32), bootMat);
    belt.position.y = 0.78;
    group.add(belt);

    // Legs
    const leftLegGroup = new THREE.Group();
    leftLegGroup.position.set(-0.13, 0.75, 0);
    const upperLegL = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.42, 0.20), uniformMat);
    upperLegL.position.y = -0.21;
    upperLegL.castShadow = true;
    leftLegGroup.add(upperLegL);
    const lowerLegL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.40, 0.18), uniformMat);
    lowerLegL.position.y = -0.62;
    lowerLegL.castShadow = true;
    leftLegGroup.add(lowerLegL);
    const kneePadL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.21), vestMat);
    kneePadL.position.y = -0.42;
    leftLegGroup.add(kneePadL);
    const bootL = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.12, 0.28), bootMat);
    bootL.position.set(0, -0.88, 0.04);
    leftLegGroup.add(bootL);
    group.add(leftLegGroup);
    this.leftLeg = leftLegGroup;

    const rightLegGroup = new THREE.Group();
    rightLegGroup.position.set(0.13, 0.75, 0);
    const upperLegR = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.42, 0.20), uniformMat);
    upperLegR.position.y = -0.21;
    upperLegR.castShadow = true;
    rightLegGroup.add(upperLegR);
    const lowerLegR = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.40, 0.18), uniformMat);
    lowerLegR.position.y = -0.62;
    lowerLegR.castShadow = true;
    rightLegGroup.add(lowerLegR);
    const kneePadR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.21), vestMat);
    kneePadR.position.y = -0.42;
    rightLegGroup.add(kneePadR);
    const bootR = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.12, 0.28), bootMat);
    bootR.position.set(0, -0.88, 0.04);
    rightLegGroup.add(bootR);
    group.add(rightLegGroup);
    this.rightLeg = rightLegGroup;

    // Weapon in hands (simplified)
    const gunGroup = new THREE.Group();
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.10, 0.55), metalMat);
    gunGroup.add(receiver);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.40, 6), metalMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -0.45;
    gunGroup.add(barrel);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.07), metalMat);
    mag.position.set(0, -0.13, 0.05);
    gunGroup.add(mag);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.10, 0.22), metalMat);
    stock.position.z = 0.35;
    gunGroup.add(stock);
    gunGroup.position.set(0.18, 1.30, 0.30);
    gunGroup.rotation.y = -0.1;
    group.add(gunGroup);
    this.gun = gunGroup;

    // Name tag (sprite)
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = isEnemy ? 'rgba(180,30,30,0.9)' : 'rgba(60,140,255,0.9)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, 252, 60);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(this.name, 128, 32);
    ctx.font = '14px Arial';
    ctx.fillText(isEnemy ? '⚠ HOSTILE' : '✓ FRIENDLY', 128, 54);
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.scale.set(1.6, 0.4, 1);
    sprite.position.y = 2.55;
    group.add(sprite);
    this.nameTag = sprite;

    // HP bar sprite
    const hpCanvas = document.createElement('canvas');
    hpCanvas.width = 128; hpCanvas.height = 12;
    this.hpCanvas = hpCanvas;
    this.hpCtx = hpCanvas.getContext('2d');
    const hpTex = new THREE.CanvasTexture(hpCanvas);
    this.hpTex = hpTex;
    const hpSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: hpTex, transparent: true, depthTest: false }));
    hpSprite.scale.set(1.4, 0.12, 1);
    hpSprite.position.y = 2.32;
    group.add(hpSprite);
    this.hpSprite = hpSprite;
    this.updateHPBar();

    group.userData.ai = this;
    return group;
  }

  updateHPBar() {
    const ctx = this.hpCtx;
    ctx.clearRect(0,0,128,12);
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0,0,128,12);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
    ctx.strokeRect(0.5,0.5,127,11);
    const pct = Math.max(0, this.health / this.maxHealth);
    let color = pct > 0.6 ? (this.faction === 'enemy' ? '#f44' : '#5cf')
              : pct > 0.3 ? '#fa3' : '#f33';
    ctx.fillStyle = color;
    ctx.fillRect(2, 2, Math.floor(124 * pct), 8);
    this.hpTex.needsUpdate = true;
  }

  /* ========== FAST BULLET HIT TEST (line vs AABB, no mesh raycast) ========== */
  // Returns { hit, point, part, mult } or null
  testBulletHit(rayOrigin, rayDir, maxDist) {
    if (this.dead) return null;
    // Account for soldier facing (rotate hitbox X/Z offsets)
    const cos = Math.cos(this.rotation);
    const sin = Math.sin(this.rotation);

    let closest = null;
    let closestT = maxDist;

    for (let i = 0; i < this.hitboxes.length; i++) {
      const hb = this.hitboxes[i];
      // World position of hitbox center
      const ox = hb.ofsX || 0;
      const oy = hb.ofsY || 0;
      const oz = hb.ofsZ || 0;
      // rotate (ox, oz) by rotation
      const wx = this.position.x + ox * cos + oz * sin;
      const wy = this.position.y + oy;
      const wz = this.position.z - ox * sin + oz * cos;

      // AABB min/max
      const minX = wx - hb.w/2, maxX = wx + hb.w/2;
      const minY = wy - hb.h/2, maxY = wy + hb.h/2;
      const minZ = wz - hb.d/2, maxZ = wz + hb.d/2;

      // Ray-AABB slab method
      const invDx = rayDir.x !== 0 ? 1/rayDir.x : 1e30;
      const invDy = rayDir.y !== 0 ? 1/rayDir.y : 1e30;
      const invDz = rayDir.z !== 0 ? 1/rayDir.z : 1e30;

      let tx1 = (minX - rayOrigin.x) * invDx;
      let tx2 = (maxX - rayOrigin.x) * invDx;
      let tmin = Math.min(tx1, tx2);
      let tmax = Math.max(tx1, tx2);

      let ty1 = (minY - rayOrigin.y) * invDy;
      let ty2 = (maxY - rayOrigin.y) * invDy;
      tmin = Math.max(tmin, Math.min(ty1, ty2));
      tmax = Math.min(tmax, Math.max(ty1, ty2));

      let tz1 = (minZ - rayOrigin.z) * invDz;
      let tz2 = (maxZ - rayOrigin.z) * invDz;
      tmin = Math.max(tmin, Math.min(tz1, tz2));
      tmax = Math.min(tmax, Math.max(tz1, tz2));

      if (tmax >= Math.max(0, tmin) && tmin < closestT && tmin >= 0) {
        closestT = tmin;
        closest = {
          part: hb.part,
          mult: hb.mult,
          t: tmin,
          point: new THREE.Vector3(
            rayOrigin.x + rayDir.x * tmin,
            rayOrigin.y + rayDir.y * tmin,
            rayOrigin.z + rayDir.z * tmin
          )
        };
      }
    }
    return closest;
  }

  /* ========== PERCEPTION (efficient) ========== */
  canSeeTarget(target, world) {
    if (!target || target.dead || !target.position) return false;
    const targetPos = target.position;
    const dx = targetPos.x - this.position.x;
    const dy = targetPos.y - this.position.y;
    const dz = targetPos.z - this.position.z;
    const distSq = dx*dx + dz*dz;  // 2D distance for FOV
    if (distSq > this.viewRange * this.viewRange) return false;

    const dist = Math.sqrt(distSq);
    if (dist < 0.01) return false;

    // FOV check (using 2D forward vector)
    const fwdX = Math.sin(this.rotation);
    const fwdZ = Math.cos(this.rotation);
    const dot = (dx * fwdX + dz * fwdZ) / dist;
    const fovCos = Math.cos((this.fov / 2) * Math.PI / 180);
    if (dot < fovCos) return false;

    // Line-of-sight: cheap AABB sweep vs cached obstacle boxes
    return world.losCheck(this.position, targetPos, dist);
  }

  /* ========== UPDATE ========== */
  update(dt, world, player) {
    if (this.dead) {
      this.deadTime += dt;
      return;
    }

    // ===== GROUND CLAMP: feet must touch terrain =====
    if (this.position.y < 0) this.position.y = 0;
    if (this.position.y > 0) {
      // simple gravity-snap (no fall physics needed for AI on flat ground)
      this.position.y = Math.max(0, this.position.y - 8 * dt);
    }

    if (this.bleeding > 0) {
      this.health -= this.bleeding * dt;
      this.bleeding -= dt * 0.1;
      if (this.health <= 0) { this.die(world); return; }
    }

    if (this.reloading && performance.now() > this.reloadEnd) {
      const need = this.weapon.magSize - this.ammo;
      const take = Math.min(need, this.reserveAmmo);
      this.ammo += take; this.reserveAmmo -= take;
      this.reloading = false;
    }

    // Target acquisition - only re-check perception every 200ms (huge perf saving)
    this.perceptionTimer = (this.perceptionTimer || 0) - dt;
    if (this.perceptionTimer <= 0) {
      this.perceptionTimer = 0.18 + Math.random() * 0.1;

      let visibleTarget = null;
      if (this.faction === 'enemy') {
        const candidates = [player];
        for (const f of world.friendlies) if (!f.dead) candidates.push(f);
        for (const c of candidates) {
          if (c && !c.dead && this.canSeeTarget(c, world)) { visibleTarget = c; break; }
        }
      } else {
        for (const e of world.enemies) {
          if (!e.dead && this.canSeeTarget(e, world)) { visibleTarget = e; break; }
        }
      }

      if (visibleTarget && visibleTarget.position) {
        this.target = visibleTarget;
        this.lastSawTarget = performance.now();
        this.lastKnownPos = visibleTarget.position.clone();
        this.alertLevel = 1;
        if (this.reactionTimer <= 0 && this.state === 'PATROL') {
          this.reactionTimer = this.reactionTime;
        }
      }
    }

    if (this.target && (this.target.dead || !this.target.position)) this.target = null;

    this.reactionTimer = Math.max(0, this.reactionTimer - dt);
    this.stateTimer += dt;

    this.updateState(dt, world, player);

    const prevX = this.position.x, prevZ = this.position.z;
    switch(this.state) {
      case 'PATROL': this.doPatrol(dt, world); break;
      case 'INVESTIGATE': this.doInvestigate(dt, world); break;
      case 'ENGAGE': this.doEngage(dt, world); break;
      case 'FLANK': this.doFlank(dt, world); break;
      case 'COVER': this.doCover(dt, world); break;
      case 'SUPPRESS': this.doSuppress(dt, world); break;
      case 'RELOAD': this.doReload(dt, world); break;
      case 'RETREAT': this.doRetreat(dt, world); break;
      case 'FOLLOW': this.doFollow(dt, world, player); break;
    }

    const dxMove = this.position.x - prevX;
    const dzMove = this.position.z - prevZ;
    const isMoving = dxMove*dxMove + dzMove*dzMove > 0.0001;
    if (isMoving) {
      this.walkPhase += dt * (this.state === 'ENGAGE' ? 8 : 6);
      const now = performance.now();
      if (now - this.lastFootstep > (this.state === 'PATROL' ? 600 : 400)) {
        this.lastFootstep = now;
        const ppx = world.playerPos.x - this.position.x;
        const ppz = world.playerPos.z - this.position.z;
        if (ppx*ppx + ppz*ppz < 400) {  // 20m audible range
          AudioEngine.playFootstep(world.map === 'forest' ? 'grass' : world.map === 'desert' ? 'sand' : 'concrete');
        }
      }
    } else {
      this.walkPhase *= 0.9;
    }

    // Smooth rotation
    let rotDiff = this.targetRotation - this.rotation;
    if (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
    if (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
    this.rotation += rotDiff * Math.min(1, dt * 6);
    this.mesh.rotation.y = this.rotation;
    this.mesh.position.copy(this.position);

    this.animateLimbs(dt, isMoving);

    // HP bar updates only on damage (handled in takeDamage)
  }

  animateLimbs(dt, moving) {
    if (!this.leftLeg) return;
    if (moving) {
      const swing = Math.sin(this.walkPhase) * 0.4;
      this.leftLeg.rotation.x = swing;
      this.rightLeg.rotation.x = -swing;
      if (this.leftArm) this.leftArm.rotation.x = -swing * 0.5;
      if (this.rightArm) this.rightArm.rotation.x = swing * 0.3 - 0.4;
    } else {
      this.leftLeg.rotation.x *= 0.9;
      this.rightLeg.rotation.x *= 0.9;
      if (this.leftArm) this.leftArm.rotation.x *= 0.9;
      if (this.rightArm) this.rightArm.rotation.x = this.rightArm.rotation.x * 0.9 + -0.04;
    }
  }

  updateState(dt, world, player) {
    if (this.ammo === 0 && !this.reloading) { this.setState('RELOAD'); return; }

    // ===== INTELLIGENT ENGAGEMENT MEMORY =====
    // If we have a target but lost LOS recently, keep ENGAGE behavior briefly,
    // then aggressively reposition (FLANK) instead of going passive.
    if (this.target && !this.target.dead && this.state === 'ENGAGE') {
      const canSee = this.canSeeTarget(this.target, world);
      if (!canSee) {
        this.losLossTime = (this.losLossTime || 0) + dt;
        // Update lastKnownPos to where target was last seen
        if (this.lastKnownPos == null) this.lastKnownPos = this.target.position.clone();
        // Briefly suppress at last-known position for 1.2s, then move to flank
        if (this.losLossTime < 1.2) {
          // Fire blind at last known pos (suppressive)
          this.tryShoot(world, dt, true);
          return;
        } else {
          this.losLossTime = 0;
          // 70%: flank to regain LOS, 30%: advance to last known
          this.setState(Math.random() < 0.7 ? 'FLANK' : 'INVESTIGATE');
          return;
        }
      } else {
        this.losLossTime = 0;
      }
    }

    if (this.health < this.maxHealth * 0.25 && this.behavior !== 'aggressive' && Math.random() < 0.5 * dt) {
      this.setState('RETREAT'); return;
    }

    // ===== FRIENDLY SQUAD AI =====
    if (this.faction === 'friendly') {
      // Adopt player's target if no current target & player is shooting at someone
      if (!this.target && world.enemies) {
        // Pick nearest visible enemy to player or self
        let best = null, bestD = Infinity;
        for (const e of world.enemies) {
          if (e.dead) continue;
          const dx = e.position.x - this.position.x;
          const dz = e.position.z - this.position.z;
          const d = dx*dx + dz*dz;
          if (d < this.viewRange*this.viewRange && d < bestD) {
            // Only adopt if visible
            if (this.canSeeTarget(e, world)) { best = e; bestD = d; }
          }
        }
        if (best) { this.target = best; this.lastSawTarget = performance.now(); }
      }
      // Stay near player when not engaged
      if (!this.target && player) {
        const dx = this.position.x - player.position.x;
        const dz = this.position.z - player.position.z;
        if (dx*dx + dz*dz > 100) { this.setState('FOLLOW'); return; }
      }
    }

    if (this.target && this.reactionTimer <= 0) {
      const canSee = this.canSeeTarget(this.target, world);
      if (canSee) {
        if (this.behavior === 'tactical' && this.stateTimer > 4 && Math.random() < 0.4) {
          this.setState(Math.random() < 0.5 ? 'FLANK' : 'SUPPRESS');
          return;
        }
        if (this.behavior === 'passive' && this.position.distanceTo(this.target.position) < 25) {
          this.setState('COVER'); return;
        }
        this.setState('ENGAGE'); return;
      } else if (this.lastKnownPos && performance.now() - this.lastSawTarget < 8000) {
        this.setState('INVESTIGATE'); return;
      }
    }

    if (!this.target && this.state !== 'PATROL' && this.state !== 'FOLLOW') {
      if (performance.now() - this.lastSawTarget > 10000) {
        this.setState('PATROL');
        this.alertLevel = Math.max(0, this.alertLevel - dt * 0.2);
      }
    }
  }

  setState(s) {
    if (this.state !== s) { this.state = s; this.stateTimer = 0; }
  }

  doPatrol(dt, world) {
    // Pause at waypoints (looks alive, gives perception time to acquire)
    if (!this.patrolTarget || this.position.distanceTo(this.patrolTarget) < 1.5) {
      if (!this.patrolPause) this.patrolPause = 1.0 + Math.random() * 2.5;
      this.patrolPause -= dt;
      // Slowly look around while paused
      this.targetRotation += dt * 0.4 * (this.patrolFacing || 1);
      if (Math.random() < dt * 0.3) this.patrolFacing = -1 * (this.patrolFacing || 1);
      if (this.patrolPause <= 0) {
        this.patrolPause = 0;
        // Pick next patrol point biased toward map exploration, not just around spawn
        const angle = Math.random() * Math.PI * 2;
        const radius = 12 + Math.random() * 18;
        this.patrolTarget = new THREE.Vector3(
          this.spawnPos.x + Math.cos(angle) * radius,
          0,
          this.spawnPos.z + Math.sin(angle) * radius
        );
        const half = world.mapSize - 5;
        this.patrolTarget.x = Math.max(-half, Math.min(half, this.patrolTarget.x));
        this.patrolTarget.z = Math.max(-half, Math.min(half, this.patrolTarget.z));
      }
      return;
    }
    this.patrolPause = 0;
    this.moveTowards(this.patrolTarget, this.walkSpeed, dt, world);
  }

  doInvestigate(dt, world) {
    if (!this.lastKnownPos) { this.setState('PATROL'); return; }
    // While investigating, keep checking if target is visible again
    if (this.target && !this.target.dead && this.canSeeTarget(this.target, world)) {
      this.lastKnownPos = this.target.position.clone();
      this.lastSawTarget = performance.now();
      this.stance = 'stand';
      this.setState('ENGAGE');
      return;
    }
    const dist = this.position.distanceTo(this.lastKnownPos);
    if (dist < 2.5) {
      // Search the area: look around, weapon ready
      this.stance = 'crouch';
      this.targetRotation += dt * 0.8 * (this.searchDir || 1);
      if (Math.random() < dt * 0.5) this.searchDir = -1 * (this.searchDir || 1);
      if (this.stateTimer > 5) {
        this.setState('PATROL');
        this.lastKnownPos = null;
        this.stance = 'stand';
      }
    } else {
      // Approach cautiously – sprint when far, jog when close
      this.stance = 'stand';
      this.moveTowards(this.lastKnownPos, dist > 15 ? this.runSpeed : this.walkSpeed * 1.5, dt, world);
    }
  }

  doEngage(dt, world) {
    if (!this.target || this.target.dead || !this.target.position) {
      this.target = null; this.setState('PATROL'); return;
    }
    const dx = this.target.position.x - this.position.x;
    const dz = this.target.position.z - this.position.z;
    const dist = Math.sqrt(dx*dx + dz*dz);
    this.targetRotation = Math.atan2(dx, dz);

    // Each AI has a PREFERRED engagement range; weapon range caps it.
    const weaponPref = this.weapon.class === 'sniper' ? 60
                     : this.weapon.class === 'shotgun' ? 8
                     : this.weapon.class === 'smg' ? 14
                     : this.weapon.class === 'pistol' ? 12 : 22;
    const ideal = Math.min(weaponPref, this.preferredRange, this.weapon.range * 0.7);

    // Too far: advance (sprint if very far, walk if close)
    if (dist > ideal + 8 && this.behavior !== 'passive') {
      const useRun = dist > ideal + 18;
      this.stance = 'stand';
      this.moveTowards(this.target.position, useRun ? this.runSpeed : this.walkSpeed * 1.4, dt, world);
    }
    // Too close (for snipers, mostly): back away
    else if (dist < ideal - 5 && this.weapon.class === 'sniper') {
      _v1.copy(this.position).sub(this.target.position).normalize().multiplyScalar(6).add(this.position);
      this.moveTowards(_v1, this.runSpeed * 0.7, dt, world);
    }
    // In the kill zone: strafe & take stance based on cover
    else {
      // Crouch when stationary in engagement (improves accuracy via stanceFactor)
      if (dist < ideal + 3 && Math.random() < dt * 0.5) this.stance = 'crouch';
      // Strafe side-to-side (slower than before so player can engage)
      if (Math.sin(this.stateTimer * 1.2) > 0.4) {
        _v1.set(Math.cos(this.targetRotation), 0, -Math.sin(this.targetRotation));
        _v2.copy(this.position).add(_v1.multiplyScalar(this.walkSpeed * dt * 0.4));
        if (!this.checkCollision(_v2, world)) this.position.copy(_v2);
      }
    }

    // Apply stance to mesh scale (visual crouch)
    if (this.mesh) {
      const targetY = this.stance === 'crouch' ? 0.7 : this.stance === 'prone' ? 0.35 : 1.0;
      this.mesh.scale.y += (targetY - this.mesh.scale.y) * Math.min(1, dt * 6);
    }

    this.tryShoot(world, dt);

    this.engageTimer += dt;
    // Tactical AI flanks / re-positions periodically
    if (this.engageTimer > 5 && this.behavior === 'tactical') {
      this.engageTimer = 0;
      const r = Math.random();
      if (r < 0.35) this.setState('FLANK');
      else if (r < 0.55) this.setState('COVER');
    }
    // Random reposition for non-tactical too (prevents rooting in place)
    if (this.engageTimer > 8 && this.behavior !== 'passive' && Math.random() < 0.3) {
      this.engageTimer = 0;
      this.setState('COVER');
    }
  }

  doFlank(dt, world) {
    if (!this.target) { this.setState('ENGAGE'); return; }
    if (!this.flankPos || this.position.distanceTo(this.flankPos) < 2) {
      _v1.copy(this.target.position).sub(this.position);
      _v2.set(-_v1.z, 0, _v1.x).normalize();
      const side = Math.random() < 0.5 ? 1 : -1;
      this.flankPos = this.target.position.clone()
        .add(_v2.multiplyScalar(side * 8))
        .add(_v1.normalize().multiplyScalar(-2));
    }
    this.stance = 'stand'; // stand up to sprint
    this.moveTowards(this.flankPos, this.runSpeed, dt, world);
    if (this.stateTimer > 6) { this.setState('ENGAGE'); this.flankPos = null; }
  }

  doCover(dt, world) {
    if (!this.coverPos) {
      const obstacles = world.obstacles || [];
      let best = null, bestDist = Infinity;
      for (const o of obstacles) {
        const dx = o.position.x - this.position.x;
        const dz = o.position.z - this.position.z;
        const d = dx*dx + dz*dz;
        if (d < 225 && d < bestDist) { bestDist = d; best = o; }
      }
      if (best && this.target) {
        _v1.copy(best.position).sub(this.target.position).normalize();
        this.coverPos = best.position.clone().add(_v1.multiplyScalar(1.8));
      } else { this.setState('ENGAGE'); return; }
    }
    this.moveTowards(this.coverPos, this.runSpeed, dt, world);
    if (this.position.distanceTo(this.coverPos) < 1.5) {
      if (this.stateTimer > 2) { this.setState('ENGAGE'); this.coverPos = null; }
    }
  }

  doSuppress(dt, world) {
    if (!this.target) { this.setState('ENGAGE'); return; }
    const dx = this.target.position.x - this.position.x;
    const dz = this.target.position.z - this.position.z;
    this.targetRotation = Math.atan2(dx, dz);
    this.tryShoot(world, dt, true);
    this.suppressTimer += dt;
    if (this.suppressTimer > 3 || this.ammo < 5) {
      this.suppressTimer = 0; this.setState('ENGAGE');
    }
  }

  doReload(dt, world) {
    if (!this.reloading) {
      this.reloading = true;
      this.reloadEnd = performance.now() + this.weapon.reloadTime * 1000;
    }
    if (this.target) {
      _v1.copy(this.position).sub(this.target.position).normalize();
      _v2.copy(this.position).add(_v1.multiplyScalar(3));
      this.moveTowards(_v2, this.walkSpeed, dt, world);
    }
    if (!this.reloading) this.setState(this.target ? 'ENGAGE' : 'PATROL');
  }

  doRetreat(dt, world) {
    if (this.target) {
      _v1.copy(this.position).sub(this.target.position).normalize();
      _v2.copy(this.position).add(_v1.multiplyScalar(10));
      this.moveTowards(_v2, this.runSpeed, dt, world);
    }
    if (this.stateTimer > 4) this.setState('COVER');
  }

  doFollow(dt, world, player) {
    if (!player) return;
    // Stagger formation: pick a position 4-6m back-left or back-right of player
    if (!this.formationOffset) {
      const side = (this.id.charCodeAt(this.id.length-1) % 2) ? 1 : -1;
      this.formationOffset = { x: side * 3, z: 5 };
    }
    const fx = -Math.sin(player.rotation.yaw);
    const fz = -Math.cos(player.rotation.yaw);
    const rx = Math.cos(player.rotation.yaw);
    const rz = -Math.sin(player.rotation.yaw);
    const tx = player.position.x + fx * this.formationOffset.z + rx * this.formationOffset.x;
    const tz = player.position.z + fz * this.formationOffset.z + rz * this.formationOffset.x;
    _v1.set(tx, this.position.y, tz);
    const dist = this.position.distanceTo(_v1);
    if (dist > 2.5) this.moveTowards(_v1, dist > 12 ? this.runSpeed : this.walkSpeed * 1.4, dt, world);
    else this.setState('PATROL');
    // Face same direction as player
    if (dist < 3) this.targetRotation = player.rotation.yaw;
  }

  moveTowards(target, speed, dt, world) {
    _v1.copy(target).sub(this.position);
    _v1.y = 0;
    const dist = _v1.length();
    if (dist < 0.1) return;
    _v1.normalize();

    _v2.copy(_v1).multiplyScalar(speed * dt);
    _v3.copy(this.position).add(_v2);

    if (!this.checkCollision(_v3, world)) {
      this.position.copy(_v3);
      this.stuckTime = 0;
    } else {
      // Try sliding LEFT around obstacle (90° left)
      _v2.set(-_v1.z * speed * dt, 0, _v1.x * speed * dt);
      _v3.copy(this.position).add(_v2);
      if (!this.checkCollision(_v3, world)) {
        this.position.copy(_v3);
        this.stuckTime = 0;
      } else {
        // Try sliding RIGHT
        _v2.set(_v1.z * speed * dt, 0, -_v1.x * speed * dt);
        _v3.copy(this.position).add(_v2);
        if (!this.checkCollision(_v3, world)) {
          this.position.copy(_v3);
          this.stuckTime = 0;
        } else {
          // Stuck – increment timer. After 1.5s, pick a fresh nav goal.
          this.stuckTime = (this.stuckTime || 0) + dt;
          if (this.stuckTime > 1.5) {
            this.stuckTime = 0;
            this.patrolTarget = null;
            this.coverPos = null;
            this.flankPos = null;
            // Big sidestep to break out
            const sideAngle = Math.random() * Math.PI * 2;
            this.position.x += Math.cos(sideAngle) * 1.5;
            this.position.z += Math.sin(sideAngle) * 1.5;
          }
        }
      }
    }
    this.targetRotation = Math.atan2(_v1.x, _v1.z);
  }

  // Uses cached bounding boxes; tighter radius lets soldiers navigate through prop clusters.
  checkCollision(pos, world) {
    const obstacles = world.obstacles || [];
    const FEET = 0;  // AI feet on ground
    const HEAD = 1.95;
    const R = 0.35;  // soldier radius (tightened from 0.4)
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      const box = o.userData.collisionBox;
      if (!box) continue;
      const obH = (box.maxY - Math.max(0, box.minY));
      if (obH < 0.5) continue;  // step over short props
      // Vertical overlap
      if (box.maxY < FEET + 0.1) continue;
      if (box.minY > HEAD) continue;
      if (pos.x > box.minX - R && pos.x < box.maxX + R &&
          pos.z > box.minZ - R && pos.z < box.maxZ + R) return true;
    }
    return false;
  }

  tryShoot(world, dt, suppressive = false) {
    if (this.reloading || this.ammo === 0) return;
    if (!this.target || this.target.dead || !this.target.position) return;

    // ===== ENGAGEMENT COORDINATOR: only one enemy fires at player at a time =====
    // Non-active shooters: very low fire rate (occasional suppressive) so they feel
    // tactical (advancing, finding cover) instead of all unloading on the player.
    const isPlayerTarget = this.faction === 'enemy' && window.Game && this.target === window.Game.player;
    if (isPlayerTarget && !Engagement.isActive(this)) {
      // Allow only ~20% of normal shots, and always treated as suppressive
      if (Math.random() > 0.18) return;
      suppressive = true;
    }

    const now = performance.now();

    // ===== TARGET TRACK TIME (initial shots are wild, settles after ~2s of tracking) =====
    if (this.target !== this.lastTargetId) {
      this.lastTargetId = this.target;
      this.targetTrackTime = 0;
      // First-shot delay: AI doesn't immediately fire when target acquired
      this.firstShotTimer = this.firstShotDelay;
    }
    this.targetTrackTime += dt;
    if (this.firstShotTimer && this.firstShotTimer > 0) {
      this.firstShotTimer -= dt;
      return; // wait before first shot
    }

    // ===== BURST CONTROL =====
    if (this.burstCooldown > 0) { this.burstCooldown -= dt; return; }
    if (this.burstShotsLeft <= 0) {
      // Start a new burst: 2-5 shots, then pause 0.4-1.2s
      this.burstShotsLeft = 2 + Math.floor(Math.random() * 4);
    }

    const fireDelay = 60000 / this.weapon.rpm;
    if (now - this.lastShot < fireDelay) return;

    this.lastShot = now;
    this.ammo--;
    this.shotsFired++;
    this.burstShotsLeft--;
    if (this.burstShotsLeft <= 0) {
      this.burstCooldown = 0.4 + Math.random() * 0.8;  // pause between bursts
    }

    _v1.copy(this.position); _v1.y += 1.5;
    _v2.copy(this.target.position); _v2.y += 1.0;
    _v3.copy(_v2).sub(_v1).normalize();

    // ===== REALISTIC ACCURACY =====
    // Base inaccuracy from skill (1 - accuracy) scaled by:
    //   * Distance falloff (linear: 1x at 10m, 3x at 60m, 5x at 100m)
    //   * Track time (3x worse at 0s, normal after 2s of tracking)
    //   * Suppressive fire flag (much wider)
    //   * Target movement (if target is sprinting, +50% inaccuracy)
    //   * Stance bonus (crouching/prone tightens shots)
    const dx = this.target.position.x - this.position.x;
    const dz = this.target.position.z - this.position.z;
    const tdist = Math.sqrt(dx*dx + dz*dz);
    const distFactor = 1 + Math.max(0, (tdist - 10) / 25);  // 1 at 10m, 3 at 60m, ~4.6 at 100m
    const trackFactor = Math.max(1, 3 - this.targetTrackTime * 1.0);  // 3 at start, 1 after 2s
    const stanceFactor = this.stance === 'crouch' ? 0.7 : (this.stance === 'prone' ? 0.5 : 1);
    const targetMovingFactor = (this.target.sprinting || (this.target.velocity && this.target.velocity.lengthSq && this.target.velocity.lengthSq() > 30)) ? 1.5 : 1;
    const baseInacc = (1 - this.accuracy) * 0.04;
    let inacc = baseInacc * distFactor * trackFactor * stanceFactor * targetMovingFactor;
    if (suppressive) inacc = Math.max(inacc, 0.12);
    // Hard cap so AI doesn't shoot literally backwards
    inacc = Math.min(inacc, 0.35);

    _v3.x += (Math.random() - 0.5) * inacc;
    _v3.y += (Math.random() - 0.5) * inacc * 0.8;
    _v3.z += (Math.random() - 0.5) * inacc;
    _v3.normalize();

    // ===== MISS-ON-PURPOSE CHANCE for low skill =====
    // Recruits sometimes deliberately fire wide so the player has time to react.
    if (Math.random() > this.aim) {
      // Add an extra big random offset – "missed shot"
      _v3.x += (Math.random() - 0.5) * 0.20;
      _v3.y += (Math.random() - 0.5) * 0.15;
      _v3.normalize();
    }

    if (window.Game) window.Game.fireBullet(_v1, _v3, this, this.weapon);

    if (this.gun) {
      const flash = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 5, 4),
        new THREE.MeshBasicMaterial({ color: 0xffcc44, transparent: true, opacity: 1 })
      );
      flash.position.set(0, 0, -0.65);
      this.gun.add(flash);
      setTimeout(() => {
        if (this.gun) this.gun.remove(flash);
        flash.geometry.dispose();
        flash.material.dispose();
      }, 50);
    }

    // Distance-based spatial sound (no Vector3 allocation)
    const sdx = this.position.x - world.playerPos.x;
    const sdy = this.position.y - world.playerPos.y;
    const sdz = this.position.z - world.playerPos.z;
    const sd = Math.sqrt(sdx*sdx + sdy*sdy + sdz*sdz);
    const vol = Math.max(0.05, Math.min(1, 25/(sd+5))) * 0.7;
    AudioEngine.playGunshot(this.weapon.sound, vol);
  }

  takeDamage(amount, hitPart = 'torso', shooter = null, dir = null) {
    if (this.dead) return false;

    // ===== RESPONSIVE AI: alert nearby squadmates =====
    if (shooter && shooter.position && window.Game) {
      const wG = window.Game.world;
      const allies = this.faction === 'enemy' ? wG.enemies : wG.friendlies;
      for (const a of allies) {
        if (a === this || a.dead) continue;
        const ddx = a.position.x - this.position.x;
        const ddz = a.position.z - this.position.z;
        const ad = ddx*ddx + ddz*ddz;
        if (ad < 1200) {  // within ~35m hear the gunshot
          if (!a.target) {
            a.target = shooter;
            a.lastKnownPos = shooter.position.clone();
            a.lastSawTarget = performance.now();
            a.alertLevel = 1;
            // Force investigation
            if (a.state === 'PATROL') a.setState('INVESTIGATE');
          }
        }
      }
    }

    let dmg = amount;
    const mult = { head: 2.5, torso: 1, larm: 0.7, rarm: 0.7, lleg: 0.8, rleg: 0.8 };
    dmg *= (mult[hitPart] || 1);

    if (hitPart === 'torso' && this.armor > 0) {
      const absorbed = Math.min(this.armor, dmg * 0.65);
      this.armor -= absorbed;
      dmg -= absorbed;
    }

    this.health -= dmg;
    this.bodyDamage[hitPart] = Math.min(100, (this.bodyDamage[hitPart] || 0) + dmg);
    if (dmg > 20) this.bleeding += 0.5;
    this.lastDamageDir = dir;

    if (shooter && !this.target) {
      this.target = shooter;
      this.lastKnownPos = shooter.position ? shooter.position.clone() : this.position.clone();
      this.lastSawTarget = performance.now();
      this.reactionTimer = this.reactionTime * 0.3;
    }

    this.updateHPBar();

    if (this.health <= 0) {
      this.killer = shooter;
      this.die(window.Game.world);
      return true;
    }
    return false;
  }

  die(world) {
    if (this.dead) return;
    this.dead = true;
    this.health = 0;
    this.mesh.rotation.x = Math.PI / 2;
    this.mesh.rotation.z = (Math.random() - 0.5) * 0.4;
    this.mesh.position.y = 0.3;
    if (this.nameTag) this.nameTag.visible = false;
    if (this.hpSprite) this.hpSprite.visible = false;
    AudioEngine.playPain();
  }
}
