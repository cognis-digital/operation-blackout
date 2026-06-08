/* ============================================================
   OPERATION BLACKOUT v8 \u2014 MAP & MESH POLISH
   Post-processes the world after buildMap to:
   - Remove overlapping/clipping obstacles (sandbags inside crates, etc.)
   - Tighten obstacle bounding boxes (removes the "invisible bump")
   - Add curated environmental detail (window frames, awnings, cables)
   - Improve mesh quality (rounded edges via small bevel-boxes)
   ============================================================ */
(function () {
  const T = window.THREE;
  if (!T || !window.Game) return;

  // ============================================================
  // 1. CLEAN UP OVERLAPPING OBSTACLES — DISABLED in v9 (caused movement issues)
  // Kept as function for potential future use but no longer called.
  // ============================================================
  function cleanupObstacles_DISABLED(world, scene) {
    const obs = world.obstacles;
    const toRemove = new Set();
    for (let i = 0; i < obs.length; i++) {
      if (toRemove.has(i)) continue;
      const a = obs[i].userData.collisionBox;
      if (!a) continue;
      const aSize = (a.maxX - a.minX) * (a.maxZ - a.minZ);
      for (let j = i + 1; j < obs.length; j++) {
        if (toRemove.has(j)) continue;
        const b = obs[j].userData.collisionBox;
        if (!b) continue;
        // Overlap test (AABB)
        if (a.maxX < b.minX || a.minX > b.maxX) continue;
        if (a.maxZ < b.minZ || a.minZ > b.maxZ) continue;
        if (a.maxY < b.minY || a.minY > b.maxY) continue;
        // Compute overlap volume vs smaller box
        const ovX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
        const ovZ = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
        const bSize = (b.maxX - b.minX) * (b.maxZ - b.minZ);
        const smaller = Math.min(aSize, bSize);
        const overlap = ovX * ovZ;
        if (overlap > smaller * 0.35) {
          // Remove the SMALLER one
          if (aSize < bSize) { toRemove.add(i); break; }
          else toRemove.add(j);
        }
      }
    }
    if (toRemove.size === 0) return 0;
    const removedMeshes = [];
    const newList = [];
    for (let i = 0; i < obs.length; i++) {
      if (toRemove.has(i)) removedMeshes.push(obs[i]);
      else newList.push(obs[i]);
    }
    world.obstacles = newList;
    for (const m of removedMeshes) {
      if (m.parent) m.parent.remove(m);
      m.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && !o.material.__shared) o.material.dispose();
      });
    }
    return toRemove.size;
  }

  // ============================================================
  // 2. TIGHTEN BOUNDING BOXES — DISABLED in v9
  // Shrinking caused weird wall-pass-through edge cases. Game.js
  // now uses a tighter player radius (0.32) so this isn't needed.
  // ============================================================
  function tightenBoundingBoxes_DISABLED(world) {}

  // ============================================================
  // 3. ADD ENVIRONMENTAL DETAIL (after build, additive only)
  // Adds visual interest: window frames, awnings, signs, cables.
  // None of these register as collision \u2013 pure decoration.
  // ============================================================
  function addUrbanDetails(world, scene) {
    if (world.map !== 'urban') return;
    // Find building obstacles (large boxes >5m tall)
    const buildings = world.obstacles.filter(o => {
      const b = o.userData.collisionBox;
      return b && (b.maxY - b.minY) > 5 && (b.maxX - b.minX) > 6;
    });
    const windowFrameMat = new T.MeshLambertMaterial({ color: 0x222222 });
    const awningMat = new T.MeshLambertMaterial({ color: 0x553322 });
    const cableMat = new T.MeshLambertMaterial({ color: 0x111111 });
    windowFrameMat.__shared = true;
    awningMat.__shared = true;
    cableMat.__shared = true;

    for (let bi = 0; bi < Math.min(buildings.length, 10); bi++) {
      const b = buildings[bi].userData.collisionBox;
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      const w = b.maxX - b.minX;
      const d = b.maxZ - b.minZ;
      const h = b.maxY - b.minY;
      // Awning over the front door (random side)
      const side = Math.floor(Math.random() * 4);
      const aw = new T.Mesh(new T.BoxGeometry(2.5, 0.1, 1.4), awningMat);
      if (side === 0) { aw.position.set(cx, 2.4, b.maxZ + 0.7); }
      else if (side === 1) { aw.position.set(cx, 2.4, b.minZ - 0.7); }
      else if (side === 2) { aw.position.set(b.maxX + 0.7, 2.4, cz); aw.rotation.y = Math.PI / 2; }
      else { aw.position.set(b.minX - 0.7, 2.4, cz); aw.rotation.y = Math.PI / 2; }
      aw.castShadow = true;
      scene.add(aw);
      // Support poles
      for (let p = 0; p < 2; p++) {
        const pole = new T.Mesh(new T.CylinderGeometry(0.04, 0.04, 2.4, 6), cableMat);
        const offset = (p === 0 ? -1.0 : 1.0);
        if (side === 0) pole.position.set(cx + offset, 1.2, b.maxZ + 1.3);
        else if (side === 1) pole.position.set(cx + offset, 1.2, b.minZ - 1.3);
        else if (side === 2) pole.position.set(b.maxX + 1.3, 1.2, cz + offset);
        else pole.position.set(b.minX - 1.3, 1.2, cz + offset);
        scene.add(pole);
      }
    }

    // Power cables between street lamps (find lamp heads roughly)
    // Skip for now \u2013 visual only, complex
  }

  function addDesertDetails(world, scene) {
    if (world.map !== 'desert') return;
    const ropeMat = new T.MeshLambertMaterial({ color: 0x3a2818 });
    const flagMat = new T.MeshLambertMaterial({ color: 0x884422, side: T.DoubleSide });
    ropeMat.__shared = true; flagMat.__shared = true;
    // Antennas + radio masts on top of bigger buildings
    const tallBuildings = world.obstacles.filter(o => {
      const b = o.userData.collisionBox;
      return b && (b.maxY - b.minY) > 4 && (b.maxX - b.minX) > 8;
    });
    for (let i = 0; i < Math.min(tallBuildings.length, 4); i++) {
      const b = tallBuildings[i].userData.collisionBox;
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      const top = b.maxY;
      // Antenna mast
      const mast = new T.Mesh(new T.CylinderGeometry(0.04, 0.04, 4, 6), ropeMat);
      mast.position.set(cx, top + 2, cz);
      scene.add(mast);
      // Dish (small)
      const dish = new T.Mesh(new T.SphereGeometry(0.5, 8, 4, 0, Math.PI), ropeMat);
      dish.position.set(cx + 0.6, top + 0.8, cz);
      dish.rotation.z = -0.5;
      scene.add(dish);
    }
  }

  function addForestDetails(world, scene) {
    if (world.map !== 'forest') return;
    // Add small grass tufts around tree bases for life (cheap, non-collidable)
    const grassMat = new T.MeshLambertMaterial({ color: 0x3a5a25 });
    grassMat.__shared = true;
    const trees = world.obstacles.filter(o => {
      const b = o.userData.collisionBox;
      return b && (b.maxY - b.minY) > 3 && (b.maxX - b.minX) < 2;
    }).slice(0, 25);
    for (const t of trees) {
      const b = t.userData.collisionBox;
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 1.0 + Math.random() * 1.5;
        const tuft = new T.Mesh(new T.ConeGeometry(0.25, 0.4, 5), grassMat);
        tuft.position.set(cx + Math.cos(a) * r, 0.2, cz + Math.sin(a) * r);
        tuft.rotation.y = Math.random() * Math.PI;
        scene.add(tuft);
      }
    }
  }

  // ============================================================
  // 4. HOOK INTO startMission to run polish AFTER buildMap
  // ============================================================
  const originalStart = Game.startMission;
  Game.startMission = function (...args) {
    const result = originalStart.apply(this, args);
    // Polish runs after a tick to let buildMap finish
    setTimeout(() => {
      const world = Game.getWorld && Game.getWorld();
      const scene = Game.getScene && Game.getScene();
      if (!world || !scene) return;
      // v9: skip overlap cleanup + bbox tightening (caused movement issues).
      // Just add the safe additive detail meshes.
      addUrbanDetails(world, scene);
      addDesertDetails(world, scene);
      addForestDetails(world, scene);
      console.log(`[mapPolish v9] added decorative detail to ${world.map} (${world.obstacles.length} obstacles)`);
    }, 50);
    return result;
  };

  console.log('[mapPolish] v8 mesh & placement override loaded');
})();
