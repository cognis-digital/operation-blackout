/* ============================================================
   OPERATION BLACKOUT v3 — Optimized + Highly Detailed Maps
   Major perf improvements:
   - Object pooling (Vector3, Raycaster, Box3 cached)
   - Cached collision boxes on obstacles
   - AABB hit-tests on soldiers (no recursive mesh raycasts)
   - Throttled HUD/radar/compass updates
   - Particle/bullet/tracer hard caps with auto-recycling
   - Merged static geometries where possible
   ============================================================ */

const Game = (() => {
  let scene, camera, renderer;
  let clock = new THREE.Clock();
  let canvas;
  let cameraAdded = false;

  // ============== Object pools (reused every frame, zero alloc in hot loops) ==============
  const POOL = {
    v1: new THREE.Vector3(), v2: new THREE.Vector3(), v3: new THREE.Vector3(),
    v4: new THREE.Vector3(), v5: new THREE.Vector3(),
    raycaster: new THREE.Raycaster(),
    euler: new THREE.Euler(0, 0, 0, 'YXZ')
  };

  // ============== PLAYER ==============
  const player = {
    position: new THREE.Vector3(0, 1.7, 0),
    velocity: new THREE.Vector3(),
    rotation: { yaw: 0, pitch: 0 },
    health: 100, maxHealth: 100,
    armor: 100, maxArmor: 100,
    bodyDamage: { head: 0, torso: 0, larm: 0, rarm: 0, lleg: 0, rleg: 0 },
    bleeding: 0,
    onGround: true,
    crouching: false,
    sprinting: false,
    ads: false,
    lean: 0,
    weapons: { primary: null, secondary: null, lethal: 'frag', tactical: 'flash' },
    currentSlot: 'primary',
    ammo: {},
    lethalCount: 2, tacticalCount: 2,
    fireMode: 0,
    lastShot: 0,
    reloading: false, reloadEnd: 0,
    drawing: false, drawEnd: 0,
    recoil: { x: 0, y: 0 },
    sway: { x: 0, y: 0 },
    bob: { x: 0, y: 0, phase: 0 },
    speed: 5.2, runSpeed: 8.5, crouchSpeed: 2.5, jumpForce: 7.2,
    stamina: 100, maxStamina: 100,
    dead: false,
    kills: 0, deaths: 0, headshots: 0,
    xp: 0, money: 500, totalKills: 0,
    name: '', rank: RANKS[0],
    classKey: 'assault', armorKey: 'medium',
    justClicked: false,
    burstActive: false, burstShotsLeft: 0
  };

  // ============== WORLD ==============
  const world = {
    obstacles: [],         // array of meshes with .userData.collisionBox = {minX,maxX,minY,maxY,minZ,maxZ}
    enemies: [],
    friendlies: [],
    bullets: [],
    tracers: [],
    grenades: [],
    particles: [],
    spawnPoints: [],
    mapSize: 120,
    map: 'urban',
    playerPos: player.position,
    sky: null,
    losCheck: null         // function (a, b, dist) => true if LOS not blocked
  };

  // ============== INPUT ==============
  const keys = {};
  let mouseDelta = { x: 0, y: 0 };
  let mouseDown = false;
  let pointerLocked = false;
  let mouseSens = 2.0;
  let invertY = false;
  let baseFov = 80;
  let showFPSCounter = true;

  let currentMission = null;
  let aiDifficulty = 'regular';
  let aiBehavior = 'balanced';
  let enemyCountSetting = 8;
  let missionState = {
    kills: 0, friendlyDeaths: 0, startTime: 0,
    wave: 0, paused: false, ended: false, time: 0
  };

  let fpsAccum = 0, fpsFrames = 0, fpsDisplay = 60;
  let weaponMesh = null;
  let muzzleLight = null;
  let footStepTimer = 0;

  // Throttle timers
  let hudUpdateAccum = 0;
  let radarUpdateAccum = 0;
  let compassUpdateAccum = 0;

  /* ============== INIT ============== */
  function init(canvasEl) {
    canvas = canvasEl;
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(baseFov, window.innerWidth / window.innerHeight, 0.05, 1000);
    camera.position.copy(player.position);

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    window.addEventListener('resize', onResize);
    setupInput();
    AudioEngine.init();

    // World LOS function uses cached obstacle boxes
    world.losCheck = function(a, b, dist) {
      // Cheap segment-vs-AABB sweep
      const dx = (b.x - a.x);
      const dz = (b.z - a.z);
      // We use 2D + a single height for soldiers at ~1.5y
      const ay = a.y + 1.5, by = b.y + 1.2;
      const obstacles = world.obstacles;
      for (let i = 0; i < obstacles.length; i++) {
        const box = obstacles[i].userData.collisionBox;
        if (!box) continue;
        // Check segment from (a.x, ay, a.z) to (b.x, by, b.z) intersects box
        const dirX = b.x - a.x, dirY = by - ay, dirZ = b.z - a.z;
        const len = Math.sqrt(dirX*dirX + dirY*dirY + dirZ*dirZ);
        if (len < 0.01) continue;
        const ndx = dirX/len, ndy = dirY/len, ndz = dirZ/len;
        const invDx = ndx !== 0 ? 1/ndx : 1e30;
        const invDy = ndy !== 0 ? 1/ndy : 1e30;
        const invDz = ndz !== 0 ? 1/ndz : 1e30;
        let tx1 = (box.minX - a.x) * invDx, tx2 = (box.maxX - a.x) * invDx;
        let tmin = Math.min(tx1, tx2), tmax = Math.max(tx1, tx2);
        let ty1 = (box.minY - ay) * invDy, ty2 = (box.maxY - ay) * invDy;
        tmin = Math.max(tmin, Math.min(ty1, ty2));
        tmax = Math.min(tmax, Math.max(ty1, ty2));
        let tz1 = (box.minZ - a.z) * invDz, tz2 = (box.maxZ - a.z) * invDz;
        tmin = Math.max(tmin, Math.min(tz1, tz2));
        tmax = Math.min(tmax, Math.max(tz1, tz2));
        if (tmax >= Math.max(0, tmin) && tmin < len - 0.5) return false;  // blocked
      }
      return true;  // LOS clear
    };
  }

  function onResize() {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // Helper: register an obstacle with cached collision box
  function registerObstacle(mesh, expandBy = 0) {
    // Force world-matrix update first so Box3.setFromObject picks up our just-applied transform
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    if (expandBy) box.expandByScalar(expandBy);
    mesh.userData.collisionBox = {
      minX: box.min.x, maxX: box.max.x,
      minY: box.min.y, maxY: box.max.y,
      minZ: box.min.z, maxZ: box.max.z
    };
    // Categorize obstacle by height for bullet/movement purposes:
    //   low (<1.2m)  – bullets pass over crouching shooters, can be vaulted visually
    //   mid (<2.5m)  – blocks bullets and movement
    //   high (>=2.5m)– walls/buildings, full block
    const h = box.max.y - Math.max(0, box.min.y);
    mesh.userData.obsHeight = h;
    world.obstacles.push(mesh);
  }

  /* ============== INPUT ============== */
  function setupInput() {
    // CRITICAL FIX: prevent default on game keys so browser doesn't steal them (Tab, Space, /, etc.)
    const GAME_KEYS = new Set(['KeyW','KeyA','KeyS','KeyD','KeyR','KeyQ','KeyE','KeyV','KeyG','KeyH','KeyM','KeyB','KeyF','KeyC','KeyX','Space','ShiftLeft','ControlLeft','Tab','Digit1','Digit2','Digit3','Digit4','Digit5']);
    document.addEventListener('keydown', e => {
      if (GAME_KEYS.has(e.code) && pointerLocked) e.preventDefault();
      keys[e.code] = true;
      handleKey(e);
    });
    document.addEventListener('keyup', e => {
      keys[e.code] = false;
      if (e.code === 'KeyQ' && player.lean === -1) player.lean = 0;
      if (e.code === 'KeyE' && player.lean === 1) player.lean = 0;
      if (e.code === 'Tab') { e.preventDefault(); UI.toggleScoreboard(false); }
    });
    // Clear all keys when window loses focus (prevents stuck keys causing "can't move" bug)
    window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseDown = false; });

    canvas.addEventListener('mousedown', e => {
      if (!pointerLocked) { canvas.requestPointerLock(); return; }
      if (e.button === 0) { mouseDown = true; player.justClicked = true; }
      if (e.button === 2) { player.ads = true; }
    });
    canvas.addEventListener('mouseup', e => {
      if (e.button === 0) { mouseDown = false; player.justClicked = false; }
      if (e.button === 2) { player.ads = false; }
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('mousemove', e => {
      if (!pointerLocked) return;
      mouseDelta.x += e.movementX;
      mouseDelta.y += e.movementY;
    });

    document.addEventListener('pointerlockchange', () => {
      pointerLocked = document.pointerLockElement === canvas;
      if (pointerLocked) AudioEngine.resume();
      // CRITICAL: clear stuck keys on lock change to prevent "can't move" bug
      // (e.g. holding W when ESC fires causes the keyup to be missed)
      if (!pointerLocked) {
        for (const k in keys) keys[k] = false;
        mouseDown = false;
        player.justClicked = false;
      }
    });

    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const w = currentWeapon();
      // While ADS with a scoped weapon, wheel adjusts zoom (2x – 20x)
      if (player.ads && w && w.scoped) {
        const baseZ = w.scopeZoom || 6;
        if (player.scopeZoomLevel == null) player.scopeZoomLevel = baseZ;
        player.scopeZoomLevel += (e.deltaY > 0 ? -1 : 1);
        player.scopeZoomLevel = Math.max(2, Math.min(20, player.scopeZoomLevel));
        AudioEngine.playClick();
        return;
      }
      const slots = ['primary', 'secondary'];
      let i = slots.indexOf(player.currentSlot);
      i = (i + (e.deltaY > 0 ? 1 : -1) + slots.length) % slots.length;
      switchSlot(slots[i]);
    }, { passive: false });
  }

  function handleKey(e) {
    if (missionState.ended) return;
    switch(e.code) {
      case 'KeyR': reload(); break;
      case 'Digit1': switchSlot('primary'); break;
      case 'Digit2': switchSlot('secondary'); break;
      case 'Digit3': switchSlot('lethal'); break;     // Equip grenade as held item
      case 'Digit4': switchSlot('tactical'); break;   // Equip tactical as held item
      case 'KeyG': throwLethal(); break;              // Quick-throw lethal
      case 'KeyF': throwTactical(); break;            // Quick-throw tactical
      case 'KeyH': bandage(); break;
      case 'KeyV': melee(); break;
      case 'KeyM': if (pointerLocked || missionState.paused) UI.toggleMap(); break;
      case 'Tab': if (pointerLocked) { e.preventDefault(); UI.toggleScoreboard(true); } break;
      case 'KeyB':
        const w = currentWeapon();
        if (w && w.fireModes && w.fireModes.length > 1) {
          player.fireMode = (player.fireMode + 1) % w.fireModes.length;
          AudioEngine.playClick();
          UI.updateHUD(true);
        }
        break;
      case 'KeyQ': player.lean = -1; break;
      case 'KeyE': player.lean = 1; break;
      case 'Escape':
        if (pointerLocked) setTimeout(() => UI.pauseGame(), 50);
        else if (!missionState.ended) UI.pauseGame();
        break;
    }
  }

  /* ============== MAP BUILDING (much more detailed!) ============== */
  function clearScene() {
    while(scene.children.length > 0) {
      const c = scene.children[0];
      scene.remove(c);
      if (c === camera) continue;
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (c.material.map) c.material.map.dispose();
        if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
        else c.material.dispose();
      }
    }
    cameraAdded = false;
  }

  function buildMap(mapName) {
    clearScene();
    world.obstacles = [];
    world.spawnPoints = [];
    world.map = mapName;

    // ====== LIGHTING ======
    let skyColor, groundLightColor, ambientColor, sunColor, sunIntensity;
    let groundColor, fogColor, fogNear, fogFar;

    if (mapName === 'desert') {
      skyColor = 0xffd99a; groundLightColor = 0xc88a40;
      ambientColor = 0xffe4b5; sunColor = 0xfff3d0; sunIntensity = 1.4;
      groundColor = 0xd4ae78;
      fogColor = 0xeacf99; fogNear = 80; fogFar = 280;
    } else if (mapName === 'urban') {
      skyColor = 0x9fb5c8; groundLightColor = 0x5a5a52;
      ambientColor = 0xc0ccd8; sunColor = 0xfff8e0; sunIntensity = 1.2;
      groundColor = 0x707068;
      fogColor = 0xa0b0b8; fogNear = 60; fogFar = 220;
    } else {
      skyColor = 0x8fa080; groundLightColor = 0x3a4828;
      ambientColor = 0xb8c8a8; sunColor = 0xfff0c8; sunIntensity = 1.1;
      groundColor = 0x4a6a3a;
      fogColor = 0x90a888; fogNear = 50; fogFar = 200;
    }

    scene.background = new THREE.Color(skyColor);
    scene.fog = new THREE.Fog(fogColor, fogNear, fogFar);

    const ambient = new THREE.AmbientLight(ambientColor, 0.75);
    scene.add(ambient);

    const hemi = new THREE.HemisphereLight(skyColor, groundLightColor, 0.6);
    hemi.position.set(0, 50, 0);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(sunColor, sunIntensity);
    sun.position.set(60, 100, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.left = -90;
    sun.shadow.camera.right = 90;
    sun.shadow.camera.top = 90;
    sun.shadow.camera.bottom = -90;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 300;
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    // Sky dome
    const skyGeo = new THREE.SphereGeometry(500, 16, 10);
    const skyMat = new THREE.MeshBasicMaterial({ color: skyColor, side: THREE.BackSide, fog: false });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    scene.add(sky);

    // Sun disc
    const sunDisc = new THREE.Mesh(
      new THREE.SphereGeometry(8, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xfff5d0, fog: false })
    );
    sunDisc.position.set(150, 180, 100);
    scene.add(sunDisc);

    // ====== GROUND ======
    const groundGeo = new THREE.PlaneGeometry(world.mapSize * 2.5, world.mapSize * 2.5, 48, 48);
    const pos = groundGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const noise = Math.sin(x * 0.05) * Math.cos(y * 0.05) * 0.4
                  + Math.sin(x * 0.15) * Math.cos(y * 0.12) * 0.15;
      pos.setZ(i, noise);
    }
    groundGeo.computeVertexNormals();

    const tex = makeGroundTexture(mapName);
    const groundMat = new THREE.MeshLambertMaterial({ color: groundColor, map: tex });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    world.ground = ground;

    if (mapName === 'urban') buildUrbanMap();
    else if (mapName === 'desert') buildDesertMap();
    else buildForestMap();

    // Boundary walls
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x404040 });
    const s = world.mapSize;
    for (const [x, z, w, d] of [
      [0, s, s*2, 2], [0, -s, s*2, 2], [s, 0, 2, s*2], [-s, 0, 2, s*2]
    ]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 8, d), wallMat);
      wall.position.set(x, 4, z);
      wall.receiveShadow = true; wall.castShadow = true;
      scene.add(wall);
      registerObstacle(wall);
    }

    // Re-add camera if it has children (weapon mesh)
    if (camera.children.length > 0) { scene.add(camera); cameraAdded = true; }
  }

  function makeGroundTexture(mapName) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 512;
    const ctx = c.getContext('2d');
    let base, dot1, dot2, line;
    if (mapName === 'desert') {
      base='#d4ae78'; dot1='#c39865'; dot2='#e5c089'; line='#b8895a';
    } else if (mapName === 'urban') {
      base='#707068'; dot1='#5a5a52'; dot2='#8a8a82'; line='#404038';
    } else {
      base='#4a6a3a'; dot1='#3a5a28'; dot2='#5a7a4a'; line='#283820';
    }
    ctx.fillStyle = base; ctx.fillRect(0,0,512,512);

    // Cracks/lines
    ctx.strokeStyle = line; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.5;
    for (let i = 0; i < 25; i++) {
      ctx.beginPath();
      let x = Math.random() * 512, y = Math.random() * 512;
      ctx.moveTo(x, y);
      for (let j = 0; j < 4; j++) {
        x += (Math.random() - 0.5) * 80;
        y += (Math.random() - 0.5) * 80;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (let i = 0; i < 1000; i++) {
      ctx.fillStyle = Math.random() < 0.5 ? dot1 : dot2;
      ctx.globalAlpha = 0.3 + Math.random() * 0.4;
      const x = Math.random() * 512, y = Math.random() * 512;
      const r = 1 + Math.random() * 4;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(20, 20);
    return tex;
  }

  function buildUrbanMap() {
    // Shared geometries & materials (MAJOR perf save)
    const buildingMats = [
      new THREE.MeshLambertMaterial({ color: 0x8a8a82 }),
      new THREE.MeshLambertMaterial({ color: 0x9a9088 }),
      new THREE.MeshLambertMaterial({ color: 0x787068 }),
      new THREE.MeshLambertMaterial({ color: 0x6a6058 }),
      new THREE.MeshLambertMaterial({ color: 0x988878 })
    ];
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });
    const winMat = new THREE.MeshPhongMaterial({ color: 0x2a3a44, emissive: 0x223344, shininess: 60 });
    const winLitMat = new THREE.MeshPhongMaterial({ color: 0x6a5a3a, emissive: 0x4a3a1a, shininess: 60 });

    // Buildings (more detailed: with windows, doors, AC units)
    const sites = [
      [-30, -25, 14, 12, 10], [-15, -30, 12, 12, 8],
      [15, -25, 16, 14, 12], [35, -20, 12, 10, 9],
      [-35, 15, 18, 14, 11], [-10, 20, 14, 12, 10],
      [20, 18, 12, 10, 8],   [40, 5, 14, 12, 9],
      [0, 0, 8, 8, 6],       [-25, -5, 10, 10, 7],
      [25, -5, 11, 9, 8],    [-45, -45, 12, 10, 8],
      [45, -45, 10, 12, 8],  [-45, 45, 10, 10, 8],
      [45, 45, 12, 10, 8],   [-65, 0, 8, 14, 7],
      [65, 0, 8, 14, 7],     [0, -65, 14, 8, 6],
      [0, 65, 14, 8, 6]
    ];
    for (const [x, z, w, d, h] of sites) {
      const mat = buildingMats[Math.floor(Math.random() * buildingMats.length)];
      const bld = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      bld.position.set(x, h/2, z);
      bld.castShadow = true; bld.receiveShadow = true;
      scene.add(bld);
      registerObstacle(bld);

      // Roof
      const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.5, d + 0.4), roofMat);
      roof.position.set(x, h + 0.25, z);
      roof.castShadow = true;
      scene.add(roof);

      // Roof structures (HVAC units, vents)
      if (Math.random() < 0.7) {
        const hvac = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.0, 1.2), roofMat);
        hvac.position.set(x + (Math.random()-0.5)*w*0.4, h + 1.0, z + (Math.random()-0.5)*d*0.4);
        hvac.castShadow = true;
        scene.add(hvac);
        const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.15, 8), new THREE.MeshLambertMaterial({color:0x222}));
        fan.position.set(hvac.position.x, h + 1.55, hvac.position.z);
        scene.add(fan);
      }

      // Antenna / pole
      if (Math.random() < 0.4) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3), new THREE.MeshLambertMaterial({color:0x444}));
        pole.position.set(x + (Math.random()-0.5)*w*0.3, h + 1.5, z + (Math.random()-0.5)*d*0.3);
        scene.add(pole);
      }

      // Door
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.1), new THREE.MeshLambertMaterial({color:0x2a1a0a}));
      door.position.set(x, 1.1, z + d/2 + 0.05);
      scene.add(door);

      // Windows (more controlled, fewer meshes per building)
      for (let wy = 1.8; wy < h - 0.8; wy += 2.5) {
        for (let wx = -w/2 + 1.5; wx < w/2 - 1; wx += 2.2) {
          const lit = Math.random() < 0.25;
          const wmat = lit ? winLitMat : winMat;
          const win = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.3, 0.08), wmat);
          win.position.set(x + wx, wy, z + d/2 + 0.03);
          scene.add(win);
          const win2 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.3, 0.08), wmat);
          win2.position.set(x + wx, wy, z - d/2 - 0.03);
          scene.add(win2);
        }
      }
    }

    // Streets between buildings (lighter color strips)
    const streetMat = new THREE.MeshLambertMaterial({ color: 0x3a3a38 });
    const streetGeo = new THREE.PlaneGeometry(6, 200);
    for (let i = 0; i < 3; i++) {
      const street = new THREE.Mesh(streetGeo, streetMat);
      street.rotation.x = -Math.PI/2;
      street.position.set(-50 + i * 50, 0.02, 0);
      street.receiveShadow = true;
      scene.add(street);
    }
    const streetGeo2 = new THREE.PlaneGeometry(200, 6);
    for (let i = 0; i < 3; i++) {
      const street = new THREE.Mesh(streetGeo2, streetMat);
      street.rotation.x = -Math.PI/2;
      street.position.set(0, 0.02, -50 + i * 50);
      street.receiveShadow = true;
      scene.add(street);
    }

    // Street lamps
    const lampPostMat = new THREE.MeshPhongMaterial({color:0x222, shininess:20});
    const lampHeadMat = new THREE.MeshBasicMaterial({color:0xffe4a0});
    for (let i = 0; i < 12; i++) {
      const x = (Math.random() - 0.5) * 100;
      const z = (Math.random() - 0.5) * 100;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.12, 5, 8), lampPostMat);
      pole.position.set(x, 2.5, z);
      pole.castShadow = true;
      scene.add(pole);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 1.2), lampPostMat);
      arm.position.set(x + 0.5, 4.8, z);
      scene.add(arm);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.5), lampHeadMat);
      head.position.set(x + 1, 4.7, z);
      scene.add(head);
    }

    // Concrete jersey barriers (more, in clusters)
    const barrierMat = new THREE.MeshLambertMaterial({ color: 0x999 });
    for (let i = 0; i < 40; i++) {
      const x = (Math.random() - 0.5) * 100;
      const z = (Math.random() - 0.5) * 100;
      // Trapezoid via box
      const bar = new THREE.Mesh(new THREE.BoxGeometry(3, 1.2, 0.6), barrierMat);
      bar.position.set(x, 0.6, z);
      bar.rotation.y = Math.random() * Math.PI;
      bar.castShadow = true; bar.receiveShadow = true;
      scene.add(bar);
      registerObstacle(bar);
      // Top narrow part
      const top = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.3, 0.3), barrierMat);
      top.position.set(x, 1.35, z);
      top.rotation.y = bar.rotation.y;
      scene.add(top);
    }

    // Shipping containers (large cover, distinctive colors)
    const containerColors = [0x884422, 0x224488, 0x447733, 0x886622, 0x442266];
    for (let i = 0; i < 8; i++) {
      const x = (Math.random() - 0.5) * 90;
      const z = (Math.random() - 0.5) * 90;
      const mat = new THREE.MeshLambertMaterial({
        color: containerColors[Math.floor(Math.random() * containerColors.length)]
      });
      const cont = new THREE.Mesh(new THREE.BoxGeometry(6, 2.6, 2.4), mat);
      cont.position.set(x, 1.3, z);
      cont.rotation.y = Math.random() * Math.PI;
      cont.castShadow = true; cont.receiveShadow = true;
      scene.add(cont);
      registerObstacle(cont);
      // Container details (corrugated lines via thin boxes)
      const dirMat = new THREE.MeshLambertMaterial({ color: mat.color.getHex() * 0.7 });
      for (let j = -2; j <= 2; j++) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.5, 2.5), dirMat);
        stripe.position.copy(cont.position);
        const local = new THREE.Vector3(j * 1.0, 0, 0).applyAxisAngle(new THREE.Vector3(0,1,0), cont.rotation.y);
        stripe.position.add(local);
        stripe.rotation.y = cont.rotation.y;
        scene.add(stripe);
      }
    }

    // Wooden crates
    const crateMats = [
      new THREE.MeshLambertMaterial({ color: 0x6a4a2a }),
      new THREE.MeshLambertMaterial({ color: 0x7a5a3a })
    ];
    for (let i = 0; i < 20; i++) {
      const x = (Math.random() - 0.5) * 90;
      const z = (Math.random() - 0.5) * 90;
      const s = 1 + Math.random() * 0.8;
      const mat = crateMats[Math.floor(Math.random() * crateMats.length)];
      const c = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), mat);
      c.position.set(x, s/2, z);
      c.rotation.y = Math.random() * Math.PI;
      c.castShadow = true; c.receiveShadow = true;
      scene.add(c);
      registerObstacle(c);
    }

    // Oil barrels (red/blue)
    const barrelMats = [
      new THREE.MeshPhongMaterial({color: 0x882211, shininess: 30}),
      new THREE.MeshPhongMaterial({color: 0x114488, shininess: 30}),
      new THREE.MeshPhongMaterial({color: 0x666633, shininess: 30})
    ];
    for (let i = 0; i < 15; i++) {
      const x = (Math.random() - 0.5) * 90;
      const z = (Math.random() - 0.5) * 90;
      const mat = barrelMats[Math.floor(Math.random() * barrelMats.length)];
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.0, 12), mat);
      barrel.position.set(x, 0.5, z);
      barrel.castShadow = true; barrel.receiveShadow = true;
      scene.add(barrel);
      registerObstacle(barrel);
      // Band
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 12), new THREE.MeshPhongMaterial({color:0x333}));
      band.position.set(x, 0.75, z);
      scene.add(band);
      const band2 = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 12), new THREE.MeshPhongMaterial({color:0x333}));
      band2.position.set(x, 0.25, z);
      scene.add(band2);
    }

    // Burned-out cars (detailed)
    for (let i = 0; i < 6; i++) {
      const x = (Math.random() - 0.5) * 80;
      const z = (Math.random() - 0.5) * 80;
      buildCar(x, z, Math.random() * Math.PI);
    }

    // Dumpsters
    const dumpMat = new THREE.MeshPhongMaterial({color: 0x224422, shininess: 20});
    for (let i = 0; i < 5; i++) {
      const x = (Math.random() - 0.5) * 80;
      const z = (Math.random() - 0.5) * 80;
      const dump = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 1.4), dumpMat);
      dump.position.set(x, 0.7, z);
      dump.rotation.y = Math.random() * Math.PI;
      dump.castShadow = true; dump.receiveShadow = true;
      scene.add(dump);
      registerObstacle(dump);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 1.4), dumpMat);
      lid.position.set(x, 1.45, z);
      lid.rotation.y = dump.rotation.y;
      scene.add(lid);
    }

    // Sandbag emplacements
    const sbMat = new THREE.MeshLambertMaterial({ color: 0xa88a5a });
    for (let i = 0; i < 6; i++) {
      const cx = (Math.random() - 0.5) * 80;
      const cz = (Math.random() - 0.5) * 80;
      const ang = Math.random() * Math.PI;
      // Build a small wall of sandbags (3 wide, 2 tall)
      for (let row = 0; row < 2; row++) {
        for (let col = -1; col <= 1; col++) {
          const sb = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 0.8), sbMat);
          const ox = col * 1.2;
          sb.position.set(cx + ox * Math.cos(ang), 0.2 + row * 0.45, cz - ox * Math.sin(ang));
          sb.rotation.y = ang + (Math.random() - 0.5) * 0.1;
          sb.castShadow = true; sb.receiveShadow = true;
          scene.add(sb);
          if (row === 0 && col === 0) registerObstacle(sb);
        }
      }
    }

    // Trash piles
    const trashMat = new THREE.MeshLambertMaterial({color: 0x664422});
    for (let i = 0; i < 12; i++) {
      const x = (Math.random() - 0.5) * 100;
      const z = (Math.random() - 0.5) * 100;
      for (let j = 0; j < 4; j++) {
        const trash = new THREE.Mesh(new THREE.BoxGeometry(0.3 + Math.random()*0.3, 0.2, 0.3 + Math.random()*0.3), trashMat);
        trash.position.set(x + (Math.random()-0.5)*1.5, 0.1, z + (Math.random()-0.5)*1.5);
        trash.rotation.y = Math.random() * Math.PI;
        scene.add(trash);
      }
    }

    world.spawnPoints = [
      new THREE.Vector3(50, 0, 50), new THREE.Vector3(-50, 0, 50),
      new THREE.Vector3(50, 0, -50), new THREE.Vector3(-50, 0, -50),
      new THREE.Vector3(0, 0, 55), new THREE.Vector3(55, 0, 0),
      new THREE.Vector3(0, 0, -55), new THREE.Vector3(-55, 0, 0),
      new THREE.Vector3(75, 0, 30), new THREE.Vector3(-75, 0, 30)
    ];
  }

  function buildCar(x, z, rotation) {
    const carGroup = new THREE.Group();
    const bodyMat = new THREE.MeshPhongMaterial({color: 0x222222, shininess: 15});
    const rustMat = new THREE.MeshPhongMaterial({color: 0x442211, shininess: 5});
    const glassMat = new THREE.MeshPhongMaterial({color: 0x111122, shininess: 80, opacity: 0.6, transparent: true});
    const tireMat = new THREE.MeshLambertMaterial({color: 0x111111});
    const rimMat = new THREE.MeshPhongMaterial({color: 0x666666, shininess: 60});

    // Main body
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.9, 1.9), bodyMat);
    body.position.y = 0.7;
    carGroup.add(body);
    // Cabin (lower for car silhouette)
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.8, 1.7), bodyMat);
    cabin.position.set(-0.1, 1.5, 0);
    carGroup.add(cabin);
    // Hood
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 1.8), rustMat);
    hood.position.set(1.3, 1.15, 0);
    carGroup.add(hood);
    // Trunk
    const trunk = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 1.8), rustMat);
    trunk.position.set(-1.5, 1.15, 0);
    carGroup.add(trunk);
    // Windshield
    const wind = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.7, 1.6), glassMat);
    wind.position.set(0.65, 1.5, 0);
    wind.rotation.z = -0.3;
    carGroup.add(wind);
    // Rear window
    const rear = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.7, 1.6), glassMat);
    rear.position.set(-0.95, 1.5, 0);
    rear.rotation.z = 0.3;
    carGroup.add(rear);
    // Side windows
    const sideW = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.05), glassMat);
    sideW.position.set(-0.1, 1.5, 0.86);
    carGroup.add(sideW);
    const sideW2 = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.05), glassMat);
    sideW2.position.set(-0.1, 1.5, -0.86);
    carGroup.add(sideW2);
    // Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.35, 12);
    for (const [wx, wz] of [[1.3, 1.0], [1.3, -1.0], [-1.3, 1.0], [-1.3, -1.0]]) {
      const w = new THREE.Mesh(wheelGeo, tireMat);
      w.rotation.x = Math.PI/2;
      w.position.set(wx, 0.42, wz);
      carGroup.add(w);
      // Rim
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.37, 8), rimMat);
      rim.rotation.x = Math.PI/2;
      rim.position.set(wx, 0.42, wz);
      carGroup.add(rim);
    }
    // Headlights
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.4), new THREE.MeshBasicMaterial({color: 0xddddaa}));
    hl.position.set(2.1, 0.9, 0.55);
    carGroup.add(hl);
    const hl2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.4), new THREE.MeshBasicMaterial({color: 0xddddaa}));
    hl2.position.set(2.1, 0.9, -0.55);
    carGroup.add(hl2);
    // Bumpers
    const bumpFront = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.4, 1.95), rustMat);
    bumpFront.position.set(2.1, 0.5, 0);
    carGroup.add(bumpFront);
    const bumpRear = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.4, 1.95), rustMat);
    bumpRear.position.set(-2.1, 0.5, 0);
    carGroup.add(bumpRear);

    carGroup.position.set(x, 0, z);
    carGroup.rotation.y = rotation;
    carGroup.children.forEach(c => { c.castShadow = true; c.receiveShadow = true; });
    scene.add(carGroup);

    // Collision proxy (single box)
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2, 1.9), new THREE.MeshBasicMaterial({ visible: false }));
    proxy.position.set(x, 1, z);
    proxy.rotation.y = rotation;
    scene.add(proxy);
    registerObstacle(proxy);
  }

  function buildDesertMap() {
    // Compound walls
    const wallMat = new THREE.MeshLambertMaterial({ color: 0xc4a878 });
    const wallMatDark = new THREE.MeshLambertMaterial({ color: 0xa88860 });

    // Main FOB compound (large central building)
    const fob = new THREE.Mesh(new THREE.BoxGeometry(22, 7, 18), wallMat);
    fob.position.set(0, 3.5, 0);
    fob.castShadow = true; fob.receiveShadow = true;
    scene.add(fob);
    registerObstacle(fob);

    // Watchtower at corners
    for (const [cx, cz] of [[-12, -10], [12, -10], [-12, 10], [12, 10]]) {
      const tower = new THREE.Mesh(new THREE.BoxGeometry(2.5, 4, 2.5), wallMatDark);
      tower.position.set(cx, 5.5, cz);
      tower.castShadow = true;
      scene.add(tower);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(3, 0.3, 3), new THREE.MeshLambertMaterial({color:0x554433}));
      roof.position.set(cx, 7.7, cz);
      scene.add(roof);
      // Roof supports
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const sup = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.1), new THREE.MeshLambertMaterial({color:0x554433}));
        sup.position.set(cx + Math.cos(a) * 1.4, 7.4, cz + Math.sin(a) * 1.4);
        scene.add(sup);
      }
    }

    // Smaller compound buildings
    const sites = [
      [-30, -30, 10, 10, 5], [30, -30, 10, 10, 5],
      [-30, 30, 10, 10, 5],  [30, 30, 10, 10, 5],
      [-55, -5, 8, 14, 4],   [55, -5, 8, 14, 4],
      [-15, -55, 10, 8, 4],  [15, -55, 10, 8, 4],
      [-15, 55, 10, 8, 4],   [15, 55, 10, 8, 4],
      [-70, -50, 8, 8, 4],   [70, -50, 8, 8, 4],
      [-70, 50, 8, 8, 4],    [70, 50, 8, 8, 4]
    ];
    for (const [x, z, w, d, h] of sites) {
      const mat = Math.random() < 0.5 ? wallMat : wallMatDark;
      const bld = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      bld.position.set(x, h/2, z);
      bld.castShadow = true; bld.receiveShadow = true;
      scene.add(bld);
      registerObstacle(bld);

      // Flat roof with parapet
      const parapet = new THREE.Mesh(new THREE.BoxGeometry(w+0.3, 0.5, 0.3), mat);
      parapet.position.set(x, h + 0.25, z + d/2);
      scene.add(parapet);
      const parapet2 = new THREE.Mesh(new THREE.BoxGeometry(w+0.3, 0.5, 0.3), mat);
      parapet2.position.set(x, h + 0.25, z - d/2);
      scene.add(parapet2);

      // Windows (small, dark openings)
      for (let wx = -w/2 + 1; wx < w/2 - 0.5; wx += 2) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.1), new THREE.MeshLambertMaterial({color: 0x111}));
        win.position.set(x + wx, 2, z + d/2 + 0.05);
        scene.add(win);
      }
      // Door
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.0, 0.1), new THREE.MeshLambertMaterial({color: 0x3a2818}));
      door.position.set(x, 1, z + d/2 + 0.05);
      scene.add(door);
    }

    // Rocks (varied sizes)
    const rockMats = [
      new THREE.MeshLambertMaterial({ color: 0x9a8060 }),
      new THREE.MeshLambertMaterial({ color: 0xa89070 }),
      new THREE.MeshLambertMaterial({ color: 0x8a7050 })
    ];
    for (let i = 0; i < 50; i++) {
      const x = (Math.random() - 0.5) * 115;
      const z = (Math.random() - 0.5) * 115;
      const s = 1 + Math.random() * 3;
      const mat = rockMats[Math.floor(Math.random() * rockMats.length)];
      const r = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), mat);
      r.position.set(x, s * 0.4, z);
      r.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
      r.castShadow = true; r.receiveShadow = true;
      scene.add(r);
      registerObstacle(r);
    }

    // Sandbag walls (clustered defensive positions)
    const sbMat = new THREE.MeshLambertMaterial({ color: 0xa88a5a });
    for (let i = 0; i < 8; i++) {
      const cx = (Math.random() - 0.5) * 80;
      const cz = (Math.random() - 0.5) * 80;
      const ang = Math.random() * Math.PI;
      // Wall: 5 wide, 2 tall
      for (let row = 0; row < 2; row++) {
        for (let col = -2; col <= 2; col++) {
          const sb = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.45, 0.8), sbMat);
          const ox = col * 1.3;
          sb.position.set(cx + ox * Math.cos(ang), 0.22 + row * 0.5, cz - ox * Math.sin(ang));
          sb.rotation.y = ang + (Math.random() - 0.5) * 0.15;
          sb.castShadow = true; sb.receiveShadow = true;
          scene.add(sb);
          if (row === 0 && col === 0) registerObstacle(sb);
        }
      }
    }

    // Wooden crates (supply caches)
    const crateMat = new THREE.MeshLambertMaterial({ color: 0x7a5a3a });
    for (let i = 0; i < 18; i++) {
      const x = (Math.random() - 0.5) * 90;
      const z = (Math.random() - 0.5) * 90;
      const s = 1 + Math.random() * 0.5;
      const c = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat);
      c.position.set(x, s/2, z);
      c.rotation.y = Math.random() * Math.PI;
      c.castShadow = true; c.receiveShadow = true;
      scene.add(c);
      registerObstacle(c);
    }

    // Oil barrels
    const drumMat = new THREE.MeshPhongMaterial({color: 0x664422, shininess: 20});
    for (let i = 0; i < 12; i++) {
      const x = (Math.random() - 0.5) * 90;
      const z = (Math.random() - 0.5) * 90;
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.0, 12), drumMat);
      barrel.position.set(x, 0.5, z);
      barrel.castShadow = true;
      scene.add(barrel);
      registerObstacle(barrel);
    }

    // Palm tree cluster (decorative)
    for (let i = 0; i < 8; i++) {
      const x = (Math.random() - 0.5) * 100;
      const z = (Math.random() - 0.5) * 100;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 6), new THREE.MeshLambertMaterial({color:0x5a3a1a}));
      trunk.position.set(x, 3, z);
      trunk.castShadow = true;
      scene.add(trunk);
      // Palm leaves
      for (let j = 0; j < 6; j++) {
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.05, 0.4), new THREE.MeshLambertMaterial({color:0x4a6a2a}));
        leaf.position.set(x, 6.2, z);
        leaf.rotation.y = (j / 6) * Math.PI * 2;
        leaf.rotation.z = -0.3;
        leaf.position.x += Math.cos(leaf.rotation.y) * 1.0;
        leaf.position.z += Math.sin(leaf.rotation.y) * 1.0;
        scene.add(leaf);
      }
      // Collision proxy
      const proxy = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 6), new THREE.MeshBasicMaterial({visible:false}));
      proxy.position.set(x, 3, z);
      scene.add(proxy);
      registerObstacle(proxy);
    }

    // Destroyed vehicle (technical)
    buildCar(20, 25, 0.5);
    buildCar(-25, -30, 1.2);

    // HESCO barriers (large square earth-filled)
    const hescoMat = new THREE.MeshLambertMaterial({color: 0xa08060});
    for (let i = 0; i < 6; i++) {
      const cx = (Math.random() - 0.5) * 90;
      const cz = (Math.random() - 0.5) * 90;
      const hesco = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.8, 2.5), hescoMat);
      hesco.position.set(cx, 0.9, cz);
      hesco.castShadow = true; hesco.receiveShadow = true;
      scene.add(hesco);
      registerObstacle(hesco);
    }

    world.spawnPoints = [
      new THREE.Vector3(65, 0, 65), new THREE.Vector3(-65, 0, 65),
      new THREE.Vector3(65, 0, -65), new THREE.Vector3(-65, 0, -65),
      new THREE.Vector3(0, 0, 80), new THREE.Vector3(80, 0, 0),
      new THREE.Vector3(0, 0, -80), new THREE.Vector3(-80, 0, 0)
    ];
  }

  function buildForestMap() {
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x3a2818 });
    const trunkMat2 = new THREE.MeshLambertMaterial({ color: 0x4a3520 });
    const leavesMat1 = new THREE.MeshLambertMaterial({ color: 0x2a4a1a });
    const leavesMat2 = new THREE.MeshLambertMaterial({ color: 0x355028 });
    const leavesMat3 = new THREE.MeshLambertMaterial({ color: 0x456238 });

    // Trees (varied sizes & types)
    for (let i = 0; i < 130; i++) {
      const x = (Math.random() - 0.5) * 115;
      const z = (Math.random() - 0.5) * 115;
      if (Math.abs(x) < 5 && Math.abs(z) < 5) continue;

      const h = 4 + Math.random() * 5;
      const trunkR = 0.3 + Math.random() * 0.25;
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(trunkR, trunkR * 1.4, h, 6),
        Math.random() < 0.5 ? trunkMat : trunkMat2
      );
      trunk.position.set(x, h / 2, z);
      trunk.castShadow = true; trunk.receiveShadow = true;
      scene.add(trunk);

      // Multi-layer leaves
      const leavesMat = [leavesMat1, leavesMat2, leavesMat3][Math.floor(Math.random()*3)];
      const treeType = Math.random();
      if (treeType < 0.5) {
        // Pine (cones)
        for (let l = 0; l < 3; l++) {
          const lr = 2.5 - l * 0.6;
          const cone = new THREE.Mesh(new THREE.ConeGeometry(lr, 2.5, 7), leavesMat);
          cone.position.set(x, h - 0.5 + l * 1.8, z);
          cone.castShadow = true;
          scene.add(cone);
        }
      } else {
        // Round leafy
        const leaves = new THREE.Mesh(
          new THREE.SphereGeometry(2.2 + Math.random(), 7, 5),
          leavesMat
        );
        leaves.position.set(x, h + 1.5, z);
        leaves.castShadow = true;
        scene.add(leaves);
      }

      // Collision proxy
      const proxy = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, h), new THREE.MeshBasicMaterial({ visible: false }));
      proxy.position.set(x, h / 2, z);
      scene.add(proxy);
      registerObstacle(proxy);
    }

    // Bushes
    const bushMats = [
      new THREE.MeshLambertMaterial({color: 0x2a4a1a}),
      new THREE.MeshLambertMaterial({color: 0x355028})
    ];
    for (let i = 0; i < 40; i++) {
      const x = (Math.random() - 0.5) * 110;
      const z = (Math.random() - 0.5) * 110;
      const mat = bushMats[Math.floor(Math.random() * bushMats.length)];
      const bush = new THREE.Mesh(new THREE.SphereGeometry(0.8 + Math.random() * 0.6, 7, 5), mat);
      bush.scale.y = 0.7;
      bush.position.set(x, 0.6, z);
      bush.castShadow = true;
      scene.add(bush);
    }

    // Rocks (varied)
    const rockMats = [
      new THREE.MeshLambertMaterial({ color: 0x556055 }),
      new THREE.MeshLambertMaterial({ color: 0x665a55 }),
      new THREE.MeshLambertMaterial({ color: 0x4a5048 })
    ];
    for (let i = 0; i < 40; i++) {
      const x = (Math.random() - 0.5) * 100;
      const z = (Math.random() - 0.5) * 100;
      const s = 0.8 + Math.random() * 2.2;
      const mat = rockMats[Math.floor(Math.random() * rockMats.length)];
      const r = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), mat);
      r.position.set(x, s * 0.4, z);
      r.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
      r.castShadow = true; r.receiveShadow = true;
      scene.add(r);
      registerObstacle(r);
    }

    // Fallen logs
    const logMat = new THREE.MeshLambertMaterial({color: 0x3a2818});
    for (let i = 0; i < 8; i++) {
      const x = (Math.random() - 0.5) * 100;
      const z = (Math.random() - 0.5) * 100;
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 4 + Math.random() * 3, 8), logMat);
      log.rotation.z = Math.PI / 2;
      log.rotation.y = Math.random() * Math.PI;
      log.position.set(x, 0.45, z);
      log.castShadow = true; log.receiveShadow = true;
      scene.add(log);
      registerObstacle(log);
    }

    // Wooden shacks/cabins (more detail)
    const woodMat = new THREE.MeshLambertMaterial({ color: 0x4a3220 });
    const woodMat2 = new THREE.MeshLambertMaterial({ color: 0x3a2818 });
    const roofMat = new THREE.MeshLambertMaterial({color: 0x554433});
    for (let i = 0; i < 7; i++) {
      const x = (Math.random() - 0.5) * 90;
      const z = (Math.random() - 0.5) * 90;

      const shack = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 5), woodMat);
      shack.position.set(x, 2, z);
      shack.castShadow = true; shack.receiveShadow = true;
      scene.add(shack);
      registerObstacle(shack);

      // Sloped roof
      const roof = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.3, 5.5), roofMat);
      roof.position.set(x, 4.5, z);
      scene.add(roof);
      const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.5, 5.5), woodMat2);
      ridge.position.set(x, 5.0, z);
      scene.add(ridge);

      // Door
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.0, 0.1), woodMat2);
      door.position.set(x, 1, z + 2.55);
      scene.add(door);
      // Window
      const win = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.8, 0.1), new THREE.MeshLambertMaterial({color:0x111}));
      win.position.set(x + 1.5, 2.5, z + 2.55);
      scene.add(win);
    }

    // Crates
    const crateMat = new THREE.MeshLambertMaterial({color: 0x6a4a2a});
    for (let i = 0; i < 15; i++) {
      const x = (Math.random() - 0.5) * 90;
      const z = (Math.random() - 0.5) * 90;
      const s = 1 + Math.random() * 0.6;
      const c = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat);
      c.position.set(x, s/2, z);
      c.rotation.y = Math.random() * Math.PI;
      c.castShadow = true; c.receiveShadow = true;
      scene.add(c);
      registerObstacle(c);
    }

    // Old wagons / barrels
    const barrelMat = new THREE.MeshLambertMaterial({color: 0x4a3320});
    for (let i = 0; i < 10; i++) {
      const x = (Math.random() - 0.5) * 90;
      const z = (Math.random() - 0.5) * 90;
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 0.9, 10), barrelMat);
      b.position.set(x, 0.45, z);
      b.castShadow = true;
      scene.add(b);
      registerObstacle(b);
    }

    // Tents (camo)
    const tentMat = new THREE.MeshLambertMaterial({color: 0x4a5a35});
    for (let i = 0; i < 4; i++) {
      const x = (Math.random() - 0.5) * 80;
      const z = (Math.random() - 0.5) * 80;
      const tent = new THREE.Mesh(new THREE.ConeGeometry(2, 2.5, 4), tentMat);
      tent.position.set(x, 1.25, z);
      tent.rotation.y = Math.PI / 4;
      tent.castShadow = true;
      scene.add(tent);
      registerObstacle(tent);
    }

    world.spawnPoints = [
      new THREE.Vector3(55, 0, 55), new THREE.Vector3(-55, 0, 55),
      new THREE.Vector3(55, 0, -55), new THREE.Vector3(-55, 0, -55),
      new THREE.Vector3(0, 0, 65), new THREE.Vector3(65, 0, 0),
      new THREE.Vector3(0, 0, -65), new THREE.Vector3(-65, 0, 0)
    ];
  }

  /* ============== SOLDIERS ============== */
  function disposeSoldier(ai) {
    if (!ai || !ai.mesh) return;
    scene.remove(ai.mesh);
    ai.mesh.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
        else o.material.dispose();
      }
    });
  }

  // ===== MINIMUM ENEMY SPAWN DISTANCE FROM PLAYER =====
  // Enemies must spawn at least this far away (m). Prevents "enemy spawned
  // 2 meters behind you and killed you instantly" scenarios.
  const MIN_SPAWN_DISTANCE = 35;

  function pickEnemySpawn(idx) {
    const points = world.spawnPoints;
    const px = player.position.x, pz = player.position.z;
    // Sort spawn points by distance to player (farthest first)
    const sorted = points.map((p, i) => {
      const dx = p.x - px, dz = p.z - pz;
      return { p, dist: Math.sqrt(dx*dx + dz*dz), i };
    }).sort((a, b) => b.dist - a.dist);
    // Use farthest available spawn rotated by idx
    const pick = sorted[idx % Math.min(sorted.length, 5)];
    // Add small jitter around the picked spawn (but keep min distance)
    for (let tries = 0; tries < 8; tries++) {
      const x = pick.p.x + (Math.random() - 0.5) * 8;
      const z = pick.p.z + (Math.random() - 0.5) * 8;
      const dx = x - px, dz = z - pz;
      const d = Math.sqrt(dx*dx + dz*dz);
      if (d >= MIN_SPAWN_DISTANCE && !playerCollides(x, 1.7, z)) {
        return new THREE.Vector3(x, 0, z);
      }
    }
    // Fallback: just use the spawn point directly
    return new THREE.Vector3(pick.p.x, 0, pick.p.z);
  }

  function spawnEnemies(count) {
    for (const e of world.enemies) disposeSoldier(e);
    world.enemies = [];
    for (let i = 0; i < count; i++) {
      const sp = pickEnemySpawn(i);
      const ai = new AISoldier({
        id: 'e' + Date.now() + '_' + i, faction: 'enemy', position: sp,
        difficulty: aiDifficulty, behavior: aiBehavior
      });
      world.enemies.push(ai);
      scene.add(ai.mesh);
    }
  }

  function spawnFriendlies(count = 2) {
    for (const f of world.friendlies) disposeSoldier(f);
    world.friendlies = [];
    for (let i = 0; i < count; i++) {
      // FIX: feet must be on ground (y=0), not at player camera height
      const sp = new THREE.Vector3(
        player.position.x + (Math.random() - 0.5) * 6,
        0,
        player.position.z + 3 + (Math.random() - 0.5) * 6
      );
      const ai = new AISoldier({
        id: 'f' + i, faction: 'friendly', position: sp,
        difficulty: 'veteran', behavior: 'tactical'
      });
      world.friendlies.push(ai);
      scene.add(ai.mesh);
    }
  }

  function addEnemy() {
    // Use the safe-distance spawn picker (same as initial spawn)
    const sp = pickEnemySpawn(Math.floor(Math.random() * world.spawnPoints.length));
    const ai = new AISoldier({
      id: 'e' + Date.now() + Math.random(), faction: 'enemy', position: sp,
      difficulty: aiDifficulty, behavior: aiBehavior
    });
    world.enemies.push(ai);
    scene.add(ai.mesh);
  }

  /* ============== WEAPON VIEW MODEL ============== */
  function buildWeaponView(weapon) {
    if (weaponMesh) {
      camera.remove(weaponMesh);
      weaponMesh.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    if (!weapon) return;

    const g = new THREE.Group();

    const matBody = new THREE.MeshPhongMaterial({ color: weapon.color, shininess: 20 });
    const matMetal = new THREE.MeshPhongMaterial({ color: 0x1a1a1a, shininess: 80, specular: 0x333333 });
    const matBarrel = new THREE.MeshPhongMaterial({ color: 0x0e0e0e, shininess: 100, specular: 0x555555 });
    const matWood = new THREE.MeshPhongMaterial({ color: 0x5a3818, shininess: 25 });
    const matPolymer = new THREE.MeshPhongMaterial({ color: 0x222222, shininess: 40 });
    const matRubber = new THREE.MeshPhongMaterial({ color: 0x111111, shininess: 5 });

    const len = weapon.length;
    const isAR = weapon.class === 'ar';
    const isSniper = weapon.class === 'sniper';
    const isPistol = weapon.class === 'pistol';
    const isSMG = weapon.class === 'smg';
    const isShotgun = weapon.class === 'shotgun';

    const recvW = isPistol ? 0.045 : 0.06;
    const recvH = isPistol ? 0.10 : 0.12;
    const recvL = len * 0.55;

    // Receiver
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(recvW, recvH, recvL), matBody);
    receiver.position.z = -recvL * 0.1;
    g.add(receiver);

    // Picatinny rail
    if (!isPistol) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(recvW * 0.7, 0.015, recvL * 0.7), matMetal);
      rail.position.set(0, recvH * 0.55, -recvL * 0.1);
      g.add(rail);
    }

    // Barrel
    const barrelLen = weapon.barrelLen;
    const barrelR = isSniper ? 0.022 : (isPistol ? 0.014 : 0.018);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(barrelR, barrelR, barrelLen, 10), matBarrel);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -recvL * 0.4 - barrelLen * 0.5;
    g.add(barrel);

    // Handguard
    if (isAR || isSMG) {
      const hg = new THREE.Mesh(
        new THREE.BoxGeometry(recvW * 1.4, recvH * 0.9, barrelLen * 0.7),
        matPolymer
      );
      hg.position.z = -recvL * 0.35 - barrelLen * 0.35;
      g.add(hg);
    }

    // Muzzle device
    let muzzleZ = -recvL * 0.4 - barrelLen - 0.02;
    if (isSniper) {
      const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.10, 8), matMetal);
      brake.rotation.x = Math.PI / 2;
      brake.position.z = muzzleZ - 0.05;
      g.add(brake);
      muzzleZ -= 0.10;
    } else if (isAR || isSMG) {
      const fh = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.06, 6), matMetal);
      fh.rotation.x = Math.PI / 2;
      fh.position.z = muzzleZ - 0.03;
      g.add(fh);
      muzzleZ -= 0.06;
    }
    g.userData.muzzleZ = muzzleZ;

    // Front + rear iron sights (back-up co-witnessed under optic)
    if (!isPistol && !isSniper) {
      // Front sight post with protective wings
      const fsBase = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.04), matMetal);
      fsBase.position.set(0, 0.06, -recvL * 0.35 - barrelLen * 0.7);
      g.add(fsBase);
      const fsPost = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.05, 0.006), matMetal);
      fsPost.position.set(0, 0.085, -recvL * 0.35 - barrelLen * 0.7);
      g.add(fsPost);
      const wingL = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.05, 0.025), matMetal);
      wingL.position.set(-0.015, 0.085, -recvL * 0.35 - barrelLen * 0.7);
      g.add(wingL);
      const wingR = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.05, 0.025), matMetal);
      wingR.position.set(0.015, 0.085, -recvL * 0.35 - barrelLen * 0.7);
      g.add(wingR);
    } else if (isPistol) {
      // Pistol iron sights (rear + front blade)
      const rear = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.012, 0.012), matMetal);
      rear.position.set(0, recvH * 0.6, recvL * 0.18);
      g.add(rear);
      const front = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.012, 0.008), matMetal);
      front.position.set(0, recvH * 0.6, -recvL * 0.2);
      g.add(front);
    }

    // Optic
    if (isSniper) {
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.30, 14), matMetal);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.10, -recvL * 0.1);
      g.add(scope);
      const obj = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.05, 14), matMetal);
      obj.rotation.x = Math.PI / 2;
      obj.position.set(0, 0.10, -recvL * 0.27);
      g.add(obj);
      const lensF = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 0.005, 14),
        new THREE.MeshPhongMaterial({ color: 0x223344, shininess: 100, opacity: 0.7, transparent: true })
      );
      lensF.rotation.x = Math.PI / 2;
      lensF.position.set(0, 0.10, -recvL * 0.295);
      g.add(lensF);
      const eye = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 14), matMetal);
      eye.rotation.x = Math.PI / 2;
      eye.position.set(0, 0.10, recvL * 0.08);
      g.add(eye);
      const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.04, 10), matMetal);
      turret.position.set(0, 0.15, -recvL * 0.12);
      g.add(turret);
    } else if (!isPistol) {
      // ===== RED-DOT SIGHT (improved, COD-style) =====
      // Mounting plate
      const rdMount = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.030, 0.09), matMetal);
      rdMount.position.set(0, 0.078, -recvL * 0.05);
      g.add(rdMount);
      // Sight housing (more detailed, rounded look via beveled box)
      const rdHousing = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.075, 0.075), matMetal);
      rdHousing.position.set(0, 0.123, -recvL * 0.05);
      g.add(rdHousing);
      // Front and rear protective hoods
      const hoodF = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.085, 0.012), matMetal);
      hoodF.position.set(0, 0.123, -recvL * 0.05 - 0.04);
      g.add(hoodF);
      const hoodR = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.085, 0.012), matMetal);
      hoodR.position.set(0, 0.123, -recvL * 0.05 + 0.04);
      g.add(hoodR);
      // Glass lens (tinted)
      const lens = new THREE.Mesh(
        new THREE.PlaneGeometry(0.040, 0.060),
        new THREE.MeshBasicMaterial({ color: 0x223344, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
      );
      lens.position.set(0, 0.123, -recvL * 0.05 - 0.030);
      g.add(lens);
      // RED DOT RETICLE (glowing, visible when ADS)
      const reticle = new THREE.Mesh(
        new THREE.CircleGeometry(0.0035, 12),
        new THREE.MeshBasicMaterial({ color: 0xff2200, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false })
      );
      reticle.position.set(0, 0.123, -recvL * 0.05 - 0.035);
      reticle.renderOrder = 999;
      reticle.visible = false;  // shown only on ADS via updateWeaponView
      g.add(reticle);
      g.userData.reticle = reticle;
      // Side adjustment turret
      const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.025, 8), matMetal);
      turret.rotation.z = Math.PI/2;
      turret.position.set(0.03, 0.123, -recvL * 0.05);
      g.add(turret);
    }

    // Magazine
    if (!isShotgun) {
      const magW = isPistol ? 0.04 : 0.06;
      const magH = isPistol ? 0.13 : (weapon.magSize > 30 ? 0.22 : 0.18);
      const magD = isPistol ? 0.05 : 0.07;
      if (weapon === WEAPONS.p90) {
        const pmag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 0.30), matPolymer);
        pmag.position.set(0, 0.08, -recvL * 0.05);
        g.add(pmag);
      } else {
        const mag = new THREE.Mesh(new THREE.BoxGeometry(magW, magH, magD), matPolymer);
        const curve = weapon === WEAPONS.ak47 ? -0.08 : 0;
        mag.position.set(0, -magH * 0.5 - recvH * 0.3, 0.02 + curve);
        if (weapon === WEAPONS.ak47) mag.rotation.x = 0.25;
        g.add(mag);
      }
    }

    // Stock
    if (!isPistol) {
      if (isSniper) {
        const stockBody = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.32), matWood);
        stockBody.position.set(0, -0.03, recvL * 0.45);
        g.add(stockBody);
        const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.14), matWood);
        cheek.position.set(0, 0.04, recvL * 0.35);
        g.add(cheek);
        const buttPad = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.13, 0.03), matRubber);
        buttPad.position.set(0, -0.02, recvL * 0.62);
        g.add(buttPad);
      } else {
        const stockTube = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.20, 6), matMetal);
        stockTube.rotation.x = Math.PI / 2;
        stockTube.position.set(0, 0, recvL * 0.35);
        g.add(stockTube);
        const stockBody = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.10, 0.18), matPolymer);
        stockBody.position.set(0, -0.01, recvL * 0.42);
        g.add(stockBody);
        const buttPad = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.025), matRubber);
        buttPad.position.set(0, -0.01, recvL * 0.52);
        g.add(buttPad);
      }
    } else {
      const slide = new THREE.Mesh(new THREE.BoxGeometry(recvW * 1.1, recvH * 0.5, recvL * 0.4), matMetal);
      slide.position.set(0, recvH * 0.35, recvL * 0.05);
      g.add(slide);
    }

    // Grip
    const grip = new THREE.Mesh(
      isPistol ? new THREE.BoxGeometry(0.045, 0.16, 0.06) : new THREE.BoxGeometry(0.045, 0.13, 0.045),
      matPolymer
    );
    grip.position.set(0, isPistol ? -0.10 : -0.10, isPistol ? 0.02 : 0.10);
    grip.rotation.x = isPistol ? 0 : 0.25;
    g.add(grip);

    // Foregrip
    if (isSMG || (isAR && weapon.name === 'M4A1 CARBINE')) {
      const fg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.10, 0.04), matPolymer);
      fg.position.set(0, -0.07, -recvL * 0.35 - barrelLen * 0.3);
      g.add(fg);
    }

    // Trigger guard
    const tg = new THREE.Mesh(
      new THREE.TorusGeometry(0.030, 0.006, 4, 8, Math.PI * 1.2),
      matMetal
    );
    tg.position.set(0, -0.045, 0.06);
    tg.rotation.x = Math.PI / 2;
    g.add(tg);

    // Hands
    const handMat = new THREE.MeshLambertMaterial({ color: 0x2a2a2a });
    const rHand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.10, 0.08), handMat);
    rHand.position.set(0.01, -0.08, 0.07);
    g.add(rHand);
    if (!isPistol) {
      const lHand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.10), handMat);
      lHand.position.set(0, -0.07, -recvL * 0.35 - barrelLen * 0.3);
      g.add(lHand);
      const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.08, 0.20), new THREE.MeshLambertMaterial({ color: 0x3d4a30 }));
      sleeve.position.set(0.05, -0.10, -recvL * 0.20);
      sleeve.rotation.z = 0.3;
      g.add(sleeve);
    }

    g.position.set(0.24, -0.20, -0.50);
    g.rotation.y = -0.05;
    g.rotation.x = 0.02;
    camera.add(g);
    if (!cameraAdded) { scene.add(camera); cameraAdded = true; }
    weaponMesh = g;

    if (!muzzleLight) {
      muzzleLight = new THREE.PointLight(0xffcc66, 0, 6, 2);
      camera.add(muzzleLight);
    }
    muzzleLight.position.set(0.24, -0.20, -0.50 + g.userData.muzzleZ - 0.5);
  }

  function currentWeapon() {
    const key = player.weapons[player.currentSlot];
    return key ? WEAPONS[key] : null;
  }

  /* ============== MISSION ============== */
  function startMission(mission, loadout) {
    currentMission = mission;
    aiDifficulty = document.getElementById('aiDifficulty').value;
    aiBehavior = document.getElementById('aiBehavior').value;
    enemyCountSetting = parseInt(document.getElementById('enemyCount').value);

    // SAFE SPAWN per map (validated against built obstacles below)
    const SAFE_SPAWNS = {
      urban:  new THREE.Vector3(0, 1.7, 60),
      desert: new THREE.Vector3(0, 1.7, 40),
      forest: new THREE.Vector3(0, 1.7, 0)
    };
    const safeSpawn = SAFE_SPAWNS[mission.map || 'urban'] || SAFE_SPAWNS.urban;
    player.position.copy(safeSpawn);
    player.velocity.set(0, 0, 0);
    // Will be re-validated after buildMap (see below)
    player.health = player.maxHealth;
    const armor = ARMOR[player.armorKey] || ARMOR.medium;
    player.maxArmor = armor.hp;
    player.armor = armor.hp;
    player.bodyDamage = { head: 0, torso: 0, larm: 0, rarm: 0, lleg: 0, rleg: 0 };
    player.bleeding = 0;
    player.dead = false;
    player.kills = 0; player.deaths = 0;
    player.lethalCount = 2; player.tacticalCount = 2;
    player.fireMode = 0;
    player.rotation.yaw = 0; player.rotation.pitch = 0;
    player.recoil.x = 0; player.recoil.y = 0;
    player.weapons = loadout || player.weapons;
    player.ammo = {};
    for (const slot of ['primary','secondary']) {
      const wk = player.weapons[slot];
      if (wk) {
        const w = WEAPONS[wk];
        player.ammo[wk] = { current: w.magSize, reserve: w.reserve };
      }
    }
    player.currentSlot = 'primary';

    missionState = {
      kills: 0, friendlyDeaths: 0, startTime: performance.now(),
      wave: 0, paused: false, ended: false, time: 0
    };

    // Reset engagement coordinator (one-enemy-at-a-time lock)
    if (window.Engagement) window.Engagement.reset();

    buildMap(mission.map || 'urban');

    // VALIDATE PLAYER SPAWN: if spawn lands inside an obstacle, find nearest clear spot.
    if (playerCollides(player.position.x, player.position.y, player.position.z)) {
      let found = false;
      for (let r = 2; r <= 30 && !found; r += 2) {
        for (let a = 0; a < 16 && !found; a++) {
          const ang = (a / 16) * Math.PI * 2;
          const tx = player.position.x + Math.cos(ang) * r;
          const tz = player.position.z + Math.sin(ang) * r;
          if (!playerCollides(tx, player.position.y, tz)) {
            player.position.x = tx;
            player.position.z = tz;
            found = true;
          }
        }
      }
      console.log('[spawn] player spawn relocated to clear space');
    }

    let initCount = enemyCountSetting;
    if (mission.type === 'defense' || mission.type === 'survival') initCount = Math.min(6, enemyCountSetting);
    spawnEnemies(initCount);

    if (mission.type !== 'assassination') spawnFriendlies(2);
    else world.friendlies = [];

    buildWeaponView(currentWeapon());

    UI.showGame();
    canvas.requestPointerLock();
    UI.setObjective(missionObjectiveText(mission));

    clock = new THREE.Clock();
    if (!animateRunning) animate();
  }

  function missionObjectiveText(m) {
    switch(m.type) {
      case 'tdm': return `Eliminate ${m.targetKills} hostiles (${missionState.kills}/${m.targetKills})`;
      case 'defense': return `Defend FOB — Wave ${missionState.wave + 1}/${m.waves}`;
      case 'assassination': return 'Locate and eliminate the HVT';
      case 'patrol': return `Patrol the area (${missionState.kills}/${m.targetKills})`;
      case 'extraction': return `Eliminate hostiles & reach extract (${missionState.kills}/${m.targetKills})`;
      case 'survival': return `Survive — Wave ${missionState.wave + 1}`;
      default: return 'Engage all hostiles';
    }
  }

  /* ============== ANIMATE ============== */
  let animateRunning = false;
  let errorCount = 0;
  function animate() {
    animateRunning = true;
    requestAnimationFrame(animate);
    const dt = Math.min(0.05, clock.getDelta());

    if (missionState.paused || missionState.ended) {
      try { renderer.render(scene, camera); } catch(e) { console.error(e); }
      return;
    }

    try {
      update(dt);
      renderer.render(scene, camera);
      errorCount = 0;
    } catch (e) {
      console.error('Frame error:', e);
      errorCount++;
      if (errorCount > 30) {
        console.error('Too many errors, halting mission');
        missionState.ended = true;
        UI.popupMessage('Mission halted due to error', '#f44');
      }
    }

    fpsAccum += dt; fpsFrames++;
    if (fpsAccum >= 0.5) {
      fpsDisplay = Math.round(fpsFrames / fpsAccum);
      fpsAccum = 0; fpsFrames = 0;
      if (showFPSCounter) UI.updateFPS(fpsDisplay);
    }
  }

  function update(dt) {
    missionState.time += dt;

    if (!player.dead) {
      updatePlayer(dt);
      updateWeaponView(dt);
    }
    updateAI(dt);
    updateBullets(dt);
    updateTracers(dt);
    updateGrenades(dt);
    updateParticles(dt);
    checkMissionState();

    // Throttled HUD updates (was every frame -> too expensive)
    hudUpdateAccum += dt;
    if (hudUpdateAccum >= 0.1) {  // 10x/sec
      hudUpdateAccum = 0;
      UI.updateHUD();
    }
    radarUpdateAccum += dt;
    if (radarUpdateAccum >= 0.15) {  // ~6x/sec
      radarUpdateAccum = 0;
      UI.updateRadar(world, player);
    }
    compassUpdateAccum += dt;
    if (compassUpdateAccum >= 0.1) {
      compassUpdateAccum = 0;
      UI.updateCompass(player.rotation.yaw);
    }
  }

  /* ============== PLAYER UPDATE ============== */
  function updatePlayer(dt) {
    const sensFactor = 0.002 * mouseSens * (player.ads ? 0.5 : 1);
    player.rotation.yaw -= mouseDelta.x * sensFactor;
    player.rotation.pitch -= mouseDelta.y * sensFactor * (invertY ? -1 : 1);
    player.rotation.pitch = Math.max(-Math.PI/2 + 0.05, Math.min(Math.PI/2 - 0.05, player.rotation.pitch));
    mouseDelta.x = 0; mouseDelta.y = 0;

    // Robust WASD: compute forward/right from yaw, then sum.
    const yawSin = Math.sin(player.rotation.yaw);
    const yawCos = Math.cos(player.rotation.yaw);
    let mvX = 0, mvZ = 0;
    if (keys['KeyW']) { mvX -= yawSin; mvZ -= yawCos; }
    if (keys['KeyS']) { mvX += yawSin; mvZ += yawCos; }
    if (keys['KeyA']) { mvX -= yawCos; mvZ += yawSin; }
    if (keys['KeyD']) { mvX += yawCos; mvZ -= yawSin; }
    const mvLen = Math.sqrt(mvX*mvX + mvZ*mvZ);
    if (mvLen > 0) { mvX /= mvLen; mvZ /= mvLen; }
    POOL.v3.set(mvX, 0, mvZ);

    player.crouching = keys['ControlLeft'] || keys['ControlRight'] || keys['KeyC'];
    const wantSprint = keys['ShiftLeft'] && !player.crouching && !player.ads && mvLen > 0 && (keys['KeyW'] || keys['KeyA'] || keys['KeyD']);
    // Stamina: drains while sprinting, regens otherwise. No sprint at 0 stamina.
    if (wantSprint && player.stamina > 5) {
      player.sprinting = true;
      player.stamina = Math.max(0, player.stamina - dt * 22);
    } else {
      player.sprinting = false;
      player.stamina = Math.min(player.maxStamina, player.stamina + dt * (mvLen > 0 ? 14 : 26));
    }

    if (POOL.v3.lengthSq() > 0) POOL.v3.normalize();

    // ===== WEIGHTED MOVEMENT =====
    const armorSlow = (ARMOR[player.armorKey] || ARMOR.medium).slowdown || 0;
    const wpn = currentWeapon();
    // Weapon weight penalty: snipers/heavy ARs slower than pistols/SMGs
    let weaponSlow = 0;
    if (wpn) {
      if (wpn.class === 'sniper') weaponSlow = 0.12;
      else if (wpn.class === 'ar') weaponSlow = 0.06;
      else if (wpn.class === 'shotgun') weaponSlow = 0.08;
      else if (wpn.class === 'pistol') weaponSlow = -0.03;
      else if (wpn.class === 'smg') weaponSlow = 0;
    }
    let targetSpeed = player.speed * (1 - armorSlow - weaponSlow);
    if (player.sprinting) targetSpeed = player.runSpeed * (1 - armorSlow - weaponSlow);
    if (player.crouching) targetSpeed = player.crouchSpeed;
    if (player.ads) targetSpeed *= 0.45;
    // Reloading slows you down (cod-style)
    if (player.reloading) targetSpeed *= 0.75;
    // Low stamina = slower
    if (player.stamina < 25) targetSpeed *= 0.85;

    const legDmg = (player.bodyDamage.lleg + player.bodyDamage.rleg) / 200;
    targetSpeed *= (1 - legDmg * 0.5);

    const targetVelX = POOL.v3.x * targetSpeed;
    const targetVelZ = POOL.v3.z * targetSpeed;
    // Weighted acceleration: ground feels grippy, air feels floaty, sprint takes time to wind up
    const groundAccel = player.sprinting ? 18 : 28;
    const accel = player.onGround ? groundAccel : 3.5;
    player.velocity.x += (targetVelX - player.velocity.x) * Math.min(1, accel * dt);
    player.velocity.z += (targetVelZ - player.velocity.z) * Math.min(1, accel * dt);

    player.velocity.y -= 22 * dt;

    if (keys['Space'] && player.onGround && player.stamina > 15) {
      player.velocity.y = player.jumpForce;
      player.onGround = false;
      player.stamina -= 12;  // jump costs stamina
      AudioEngine.playFootstep && AudioEngine.playFootstep(
        world.map === 'forest' ? 'grass' : (world.map === 'desert' ? 'sand' : 'concrete'),
        true
      );
    }

    // ===== ROCK-SOLID per-axis collision with wall sliding =====
    // Strategy: try desired motion on each axis independently. If blocked,
    // bisect-search the largest fraction (0..1) of the move that doesn't collide.
    // This guarantees you slide along walls smoothly with NO sticky / stuck corners.
    const dx = player.velocity.x * dt;
    const dz = player.velocity.z * dt;

    // X axis
    if (dx !== 0) {
      let nx = player.position.x + dx;
      if (!playerCollides(nx, player.position.y, player.position.z)) {
        player.position.x = nx;
      } else {
        // Binary search the safe fraction
        let lo = 0, hi = 1;
        for (let i = 0; i < 6; i++) {
          const mid = (lo + hi) * 0.5;
          if (!playerCollides(player.position.x + dx * mid, player.position.y, player.position.z)) lo = mid;
          else hi = mid;
        }
        player.position.x += dx * lo;
        player.velocity.x = 0;  // killed perpendicular velocity
      }
    }
    // Z axis (same approach)
    if (dz !== 0) {
      let nz = player.position.z + dz;
      if (!playerCollides(player.position.x, player.position.y, nz)) {
        player.position.z = nz;
      } else {
        let lo = 0, hi = 1;
        for (let i = 0; i < 6; i++) {
          const mid = (lo + hi) * 0.5;
          if (!playerCollides(player.position.x, player.position.y, player.position.z + dz * mid)) lo = mid;
          else hi = mid;
        }
        player.position.z += dz * lo;
        player.velocity.z = 0;
      }
    }

    let ny = player.position.y + player.velocity.y * dt;
    const groundY = player.crouching ? 1.2 : 1.7;
    if (ny <= groundY) {
      ny = groundY;
      player.velocity.y = 0;
      player.onGround = true;
    } else {
      player.onGround = false;
    }
    player.position.y = ny;
    world.playerPos = player.position;

    const half = world.mapSize - 2;
    if (player.position.x < -half) player.position.x = -half;
    if (player.position.x > half) player.position.x = half;
    if (player.position.z < -half) player.position.z = -half;
    if (player.position.z > half) player.position.z = half;

    // Footsteps
    const speed2d = Math.sqrt(player.velocity.x*player.velocity.x + player.velocity.z*player.velocity.z);
    if (speed2d > 0.5 && player.onGround) {
      footStepTimer += dt;
      const interval = player.sprinting ? 0.32 : (player.crouching ? 0.7 : 0.50);
      if (footStepTimer >= interval) {
        footStepTimer = 0;
        AudioEngine.playFootstep(
          world.map === 'forest' ? 'grass' : (world.map === 'desert' ? 'sand' : 'concrete'),
          player.sprinting
        );
      }
    }

    // View bobbing
    if (player.onGround && speed2d > 0.3) {
      player.bob.phase += dt * (player.sprinting ? 12 : 8);
      const bobIntensity = player.ads ? 0.003 : (player.sprinting ? 0.025 : 0.015);
      player.bob.x = Math.sin(player.bob.phase) * bobIntensity;
      player.bob.y = Math.abs(Math.cos(player.bob.phase)) * bobIntensity * 0.7;
    } else {
      player.bob.x *= 0.85;
      player.bob.y *= 0.85;
    }

    // Camera position
    POOL.v2.set(Math.cos(player.rotation.yaw), 0, -Math.sin(player.rotation.yaw)).multiplyScalar(player.lean * 0.5);
    camera.position.copy(player.position).add(POOL.v2);
    camera.position.x += player.bob.x;
    camera.position.y += player.bob.y;
    camera.rotation.order = 'YXZ';
    camera.rotation.y = player.rotation.yaw;
    camera.rotation.x = player.rotation.pitch + player.recoil.x;
    camera.rotation.z = -player.lean * 0.12;

    player.recoil.x += (0 - player.recoil.x) * Math.min(1, dt * 8);
    player.recoil.y += (0 - player.recoil.y) * Math.min(1, dt * 12);

    const t = performance.now() * 0.001;
    const swayMag = player.ads ? 0.0008 : (player.sprinting ? 0.008 : 0.003);
    player.sway.x = Math.sin(t * 2) * swayMag;
    player.sway.y = Math.cos(t * 1.3) * swayMag * 0.5;

    const w = currentWeapon();
    let targetFov = baseFov;
    if (player.ads && w) {
      // Scoped weapons: use dynamic zoom (wheel-adjustable)
      if (w.scoped) {
        const baseZ = w.scopeZoom || 6;
        if (player.scopeZoomLevel == null) player.scopeZoomLevel = baseZ;
        // FOV = 70deg / zoom (approximate real scope math)
        targetFov = Math.max(4, 70 / player.scopeZoomLevel);
      } else {
        targetFov = baseFov * (w.adsFovMult || 0.7);
      }
    } else {
      player.scopeZoomLevel = null;  // reset when unscoped
    }
    if (player.sprinting && !player.ads) targetFov = baseFov * 1.08;
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
    camera.updateProjectionMatrix();

    // SCOPE: hide hand/weapon when scoped, show scope overlay, allow wheel zoom adjust
    if (player.ads && w && w.scoped) {
      UI.showScope(true, player.scopeZoomLevel || (w.scopeZoom || 6));
      if (weaponMesh) weaponMesh.visible = false;
    } else {
      UI.showScope(false);
      if (weaponMesh) weaponMesh.visible = true;
    }

    if (player.bleeding > 0) {
      player.health -= player.bleeding * dt;
      player.bleeding -= dt * 0.05;
      if (player.health <= 0) killPlayer('Bled out');
    }

    if (player.reloading && performance.now() > player.reloadEnd) {
      const wk = player.weapons[player.currentSlot];
      const am = player.ammo[wk];
      const need = WEAPONS[wk].magSize - am.current;
      const take = Math.min(need, am.reserve);
      am.current += take; am.reserve -= take;
      player.reloading = false;
    }
    if (player.drawing && performance.now() > player.drawEnd) {
      player.drawing = false;
    }

    if (mouseDown && !player.reloading && !player.drawing) tryShoot();

    if (muzzleLight) muzzleLight.intensity *= 0.85;
  }

  // Capsule collision with auto-step + tight radius for smooth navigation through props.
  function playerCollides(x, y, z) {
    const obstacles = world.obstacles;
    const feetY = y - (player.crouching ? 1.2 : 1.7);
    const headY = y + 0.1;
    const PR = 0.32;  // tightened from 0.42 → you can squeeze between props 0.65m apart
    const AUTO_STEP_H = 0.7; // auto-vault props up to knee-high
    for (let i = 0; i < obstacles.length; i++) {
      const ob = obstacles[i];
      const box = ob.userData.collisionBox;
      if (!box) continue;
      // Auto-step over short obstacles (was 0.5, now 0.7 – knee height)
      const obTop = box.maxY;
      if (obTop - Math.max(0, box.minY) < AUTO_STEP_H && obTop < feetY + AUTO_STEP_H) continue;
      // Vertical overlap
      if (obTop < feetY + 0.05) continue;
      if (box.minY > headY) continue;
      // Horizontal
      const minX = box.minX - PR, maxX = box.maxX + PR;
      const minZ = box.minZ - PR, maxZ = box.maxZ + PR;
      if (x > minX && x < maxX && z > minZ && z < maxZ) return true;
    }
    return false;
  }

  // ===== OBSTACLE PLACEMENT HELPER – prevents overlapping props =====
  // Returns true if placing a prop of radius R at (x,z) would clip existing obstacles.
  function isPlacementBlocked(x, z, radius, minClearance = 1.0) {
    const need = radius + minClearance;
    for (let i = 0; i < world.obstacles.length; i++) {
      const box = world.obstacles[i].userData.collisionBox;
      if (!box) continue;
      const minX = box.minX - need, maxX = box.maxX + need;
      const minZ = box.minZ - need, maxZ = box.maxZ + need;
      if (x > minX && x < maxX && z > minZ && z < maxZ) return true;
    }
    return false;
  }
  // Try up to N random placements until one is clear; returns {x,z} or null.
  function findFreeSpot(centerX, centerZ, halfRange, radius, clearance = 1.0, tries = 12) {
    for (let i = 0; i < tries; i++) {
      const x = centerX + (Math.random() - 0.5) * halfRange * 2;
      const z = centerZ + (Math.random() - 0.5) * halfRange * 2;
      if (!isPlacementBlocked(x, z, radius, clearance)) return { x, z };
    }
    return null;
  }

  function updateWeaponView(dt) {
    if (!weaponMesh) return;
    const w = currentWeapon();
    const isPistol = w && w.class === 'pistol';
    const isSniper = w && w.class === 'sniper';

    // ===== ADS perfectly centers sights along Z-axis (iron sight alignment) =====
    // When ADS, weapon moves to center & slightly forward so the rear/front sights line up with the camera lens.
    const adsX = 0;
    const adsY = isPistol ? -0.085 : (isSniper ? -0.095 : -0.085);
    const adsZ = isSniper ? -0.18 : (isPistol ? -0.22 : -0.25);
    // Hip position
    const hipX = (isPistol ? 0.18 : 0.24) + player.sway.x * 5;
    const hipY = (-0.22) + player.sway.y * 5;
    const hipZ = -0.50;

    // ===== RELOAD ANIMATION: drop weapon down/rotate during reload =====
    let reloadOffY = 0, reloadRotX = 0, reloadRotZ = 0;
    if (player.reloading) {
      const t = (performance.now() - player.reloadStart) / player.reloadDuration; // 0..1
      // Bell curve: dip then return
      const dip = Math.sin(t * Math.PI);
      reloadOffY = -0.18 * dip;
      reloadRotX = -0.6 * dip;
      reloadRotZ = 0.25 * dip;
    }
    // ===== DRAW ANIMATION =====
    let drawOffY = 0;
    if (player.drawing) {
      const t = 1 - (player.drawEnd - performance.now()) / ((w?.drawTime || 0.4) * 1000);
      drawOffY = -0.5 * (1 - Math.min(1, Math.max(0, t)));
    }

    const tx = player.ads && !player.reloading ? adsX : hipX;
    const ty = (player.ads && !player.reloading ? adsY : hipY) + reloadOffY + drawOffY;
    const tz = player.ads && !player.reloading ? adsZ : hipZ;
    const lerp = Math.min(1, dt * 16);
    weaponMesh.position.x += (tx - weaponMesh.position.x) * lerp;
    weaponMesh.position.y += (ty - weaponMesh.position.y) * lerp;
    weaponMesh.position.z += (tz - weaponMesh.position.z) * lerp;
    weaponMesh.position.z += player.recoil.x * 0.8;
    weaponMesh.rotation.x = 0.02 - player.recoil.x * 1.6 + reloadRotX;
    weaponMesh.rotation.y = player.ads ? 0 : -0.05 + player.recoil.y * 0.5;
    weaponMesh.rotation.z = reloadRotZ;

    // Hide muzzle flash + reticle when reloading
    if (weaponMesh.userData.reticle) {
      weaponMesh.userData.reticle.visible = player.ads && !player.reloading;
    }
  }

  /* ============== SHOOTING ============== */
  function tryShoot() {
    const w = currentWeapon();
    if (!w) return;
    const wk = player.weapons[player.currentSlot];
    const am = player.ammo[wk];
    if (!am) return;

    const now = performance.now();
    const fireDelay = 60000 / w.rpm;
    if (now - player.lastShot < fireDelay) return;

    if (am.current <= 0) {
      AudioEngine.playDryFire();
      player.lastShot = now;
      reload();
      return;
    }

    const mode = w.fireModes[player.fireMode];
    if (mode === 'semi' || mode === 'pump' || w.boltAction) {
      if (!player.justClicked) return;
      player.justClicked = false;
    }
    if (mode === 'burst') {
      if (!player.justClicked && !player.burstActive) return;
      if (!player.burstActive) {
        player.burstActive = true;
        player.burstShotsLeft = 3;
        player.justClicked = false;
      }
    }

    player.lastShot = now;
    am.current--;

    if (mode === 'burst') {
      player.burstShotsLeft--;
      if (player.burstShotsLeft <= 0) player.burstActive = false;
    }

    const origin = POOL.v1.copy(camera.position);
    const forward = POOL.v2.set(0, 0, -1).applyEuler(camera.rotation);

    const spread = player.ads ? w.spread.ads : (player.sprinting ? w.spread.move * 1.5 : w.spread.hip);

    if (w.pellets) {
      for (let i = 0; i < w.pellets; i++) {
        const dir = new THREE.Vector3().copy(forward);
        const sX = (Math.random() - 0.5) * spread;
        const sY = (Math.random() - 0.5) * spread;
        const r = POOL.v3.set(1, 0, 0).applyEuler(camera.rotation);
        const u = POOL.v4.set(0, 1, 0).applyEuler(camera.rotation);
        dir.addScaledVector(r, sX).addScaledVector(u, sY).normalize();
        fireBullet(origin, dir, player, w);
      }
    } else {
      const dir = new THREE.Vector3().copy(forward);
      const sX = (Math.random() - 0.5) * spread;
      const sY = (Math.random() - 0.5) * spread;
      const r = POOL.v3.set(1, 0, 0).applyEuler(camera.rotation);
      const u = POOL.v4.set(0, 1, 0).applyEuler(camera.rotation);
      dir.addScaledVector(r, sX).addScaledVector(u, sY).normalize();
      fireBullet(origin, dir, player, w);
    }

    const recoilMult = player.ads ? 0.55 : 1;
    player.recoil.x += w.recoil.v * recoilMult;
    player.recoil.y += (Math.random() - 0.5) * w.recoil.h * recoilMult;
    player.rotation.pitch -= w.recoil.v * recoilMult * 0.6;

    spawnMuzzleFlash();
    AudioEngine.playGunshot(w.sound, 1);
    UI.flashCrosshairSpread();
  }

  function fireBullet(origin, dir, shooter, weapon) {
    const bullet = {
      pos: new THREE.Vector3().copy(origin),
      dir: new THREE.Vector3().copy(dir).normalize(),
      velocity: weapon.velocity,
      gravity: 9.8,
      timeAlive: 0,
      maxTime: 2.5,
      damage: weapon.damage * (shooter.dmgMult || 1),
      shooter,
      weapon
    };
    world.bullets.push(bullet);

    if (Math.random() < 0.4 || weapon.class === 'sniper') {
      spawnTracer(origin, dir, weapon.velocity, weapon.class === 'sniper' ? 0xff4422 : 0xffaa44);
    }
  }

  function spawnTracer(origin, dir, vel, color) {
    const len = 1.2;
    const geo = new THREE.CylinderGeometry(0.015, 0.015, len, 5);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(origin).addScaledVector(dir, 2);
    POOL.v1.copy(mesh.position).add(dir);
    mesh.lookAt(POOL.v1);
    mesh.rotateX(Math.PI / 2);
    scene.add(mesh);
    world.tracers.push({ mesh, pos: mesh.position.clone(), dir: dir.clone(), vel, life: 0.4 });
  }

  function updateTracers(dt) {
    // Hard cap
    if (world.tracers.length > 60) {
      const excess = world.tracers.splice(0, world.tracers.length - 60);
      for (const t of excess) {
        scene.remove(t.mesh);
        if (t.mesh.geometry) t.mesh.geometry.dispose();
        if (t.mesh.material) t.mesh.material.dispose();
      }
    }
    for (let i = world.tracers.length - 1; i >= 0; i--) {
      const t = world.tracers[i];
      t.life -= dt;
      t.pos.addScaledVector(t.dir, t.vel * dt);
      t.mesh.position.copy(t.pos);
      if (t.mesh.material) t.mesh.material.opacity = Math.max(0, t.life / 0.4) * 0.9;
      if (t.life <= 0) {
        scene.remove(t.mesh);
        if (t.mesh.geometry) t.mesh.geometry.dispose();
        if (t.mesh.material) t.mesh.material.dispose();
        world.tracers.splice(i, 1);
      }
    }
  }

  function updateBullets(dt) {
    // Hard cap
    if (world.bullets.length > 150) world.bullets.splice(0, world.bullets.length - 150);

    for (let i = world.bullets.length - 1; i >= 0; i--) {
      const b = world.bullets[i];
      b.timeAlive += dt;
      const moveDist = b.velocity * dt;
      b.dir.y -= (b.gravity * dt) / Math.max(50, b.velocity);
      b.dir.normalize();

      let hit = null;
      let hitDist = moveDist;

      // ==== Soldier hits (FAST: AABB hit tests, no mesh raycast) ====
      const targets = (b.shooter && b.shooter.faction === 'enemy') ? world.friendlies : world.enemies;
      for (let j = 0; j < targets.length; j++) {
        const t = targets[j];
        if (t.dead) continue;
        // Quick distance cull
        const dx = t.position.x - b.pos.x;
        const dz = t.position.z - b.pos.z;
        if (dx*dx + dz*dz > (moveDist + 3) * (moveDist + 3)) continue;
        const result = t.testBulletHit(b.pos, b.dir, hitDist);
        if (result && result.t < hitDist) {
          hit = { type: 'soldier', target: t, part: result.part, point: result.point, dist: result.t };
          hitDist = result.t;
        }
      }

      // Player hit (if enemy bullet)
      if (b.shooter && b.shooter.faction === 'enemy' && !player.dead) {
        const dx = player.position.x - b.pos.x;
        const dz = player.position.z - b.pos.z;
        const dy = player.position.y - b.pos.y;
        const proj = dx*b.dir.x + dy*b.dir.y + dz*b.dir.z;
        if (proj > 0 && proj < moveDist) {
          const cx = b.pos.x + b.dir.x * proj;
          const cy = b.pos.y + b.dir.y * proj;
          const cz = b.pos.z + b.dir.z * proj;
          const ddx = cx - player.position.x;
          const ddy = cy - player.position.y;
          const ddz = cz - player.position.z;
          // Player capsule approx
          const distH = Math.sqrt(ddx*ddx + ddz*ddz);
          if (distH < 0.45 && Math.abs(ddy) < 1.0 && proj < hitDist) {
            const yDiff = cy - (player.position.y - 0.5);
            let part = 'torso';
            if (yDiff > 0.65) part = 'head';
            else if (yDiff < -0.1) part = Math.random() < 0.5 ? 'lleg' : 'rleg';
            hit = { type: 'player', point: new THREE.Vector3(cx, cy, cz), part, dist: proj };
            hitDist = proj;
          }
          // Whizz for near misses
          if (distH < 1.8 && distH > 0.5 && !b._whizzed) {
            b._whizzed = true;
            AudioEngine.playWhizz();
          }
        }
      }

      // FIX: give bullets a 0.4m grace distance from shooter so they don't
      // immediately collide with the wall/cover the shooter is standing in.
      const bulletStart = b.timeAlive < 0.05 ? 0.4 : 0;

      // Obstacle hits (using cached AABBs)
      for (let j = 0; j < world.obstacles.length; j++) {
        const ob = world.obstacles[j];
        const box = ob.userData.collisionBox;
        if (!box) continue;
        // Skip very small/short props – they shouldn't stop bullets (trash, sandbag tops, etc.)
        const obH = ob.userData.obsHeight || (box.maxY - box.minY);
        if (obH < 0.35) continue;
        const dx = (box.minX + box.maxX) * 0.5 - b.pos.x;
        const dz = (box.minZ + box.maxZ) * 0.5 - b.pos.z;
        // Cull distant obstacles
        if (dx*dx + dz*dz > (moveDist + 8) * (moveDist + 8)) continue;
        // Ray-AABB slab
        const invDx = b.dir.x !== 0 ? 1/b.dir.x : 1e30;
        const invDy = b.dir.y !== 0 ? 1/b.dir.y : 1e30;
        const invDz = b.dir.z !== 0 ? 1/b.dir.z : 1e30;
        let tx1 = (box.minX - b.pos.x) * invDx;
        let tx2 = (box.maxX - b.pos.x) * invDx;
        let tmin = Math.min(tx1, tx2), tmax = Math.max(tx1, tx2);
        let ty1 = (box.minY - b.pos.y) * invDy;
        let ty2 = (box.maxY - b.pos.y) * invDy;
        tmin = Math.max(tmin, Math.min(ty1, ty2));
        tmax = Math.min(tmax, Math.max(ty1, ty2));
        let tz1 = (box.minZ - b.pos.z) * invDz;
        let tz2 = (box.maxZ - b.pos.z) * invDz;
        tmin = Math.max(tmin, Math.min(tz1, tz2));
        tmax = Math.min(tmax, Math.max(tz1, tz2));
        if (tmax >= Math.max(bulletStart, tmin) && tmin < hitDist && tmin >= bulletStart) {
          hit = {
            type: 'obstacle',
            target: ob,
            point: new THREE.Vector3(
              b.pos.x + b.dir.x * tmin,
              b.pos.y + b.dir.y * tmin,
              b.pos.z + b.dir.z * tmin
            ),
            dist: tmin
          };
          hitDist = tmin;
        }
      }

      if (hit) {
        b.pos.copy(hit.point);
        if (hit.type === 'soldier') {
          const killed = hit.target.takeDamage(b.damage, hit.part, b.shooter, b.dir);
          spawnBloodHit(hit.point, b.dir);
          AudioEngine.playImpact('flesh', distGain(hit.point));
          if (b.shooter === player) {
            UI.showHitMarker(killed, hit.part === 'head');
            AudioEngine.playHitmarker(hit.part === 'head');
            if (killed) {
              player.kills++; missionState.kills++;
              const headshot = hit.part === 'head';
              if (headshot) player.headshots++;
              const xpGain = 100 + (headshot ? 50 : 0);
              awardXP(xpGain); awardMoney(150);
              UI.addKillfeed(player.name + ' (You)', hit.target.name, b.weapon.name, headshot);
            }
          }
        } else if (hit.type === 'player') {
          damagePlayer(b.damage, hit.part, b.shooter, b.dir);
        } else if (hit.type === 'obstacle') {
          const color = (hit.target.material && hit.target.material.color) ? hit.target.material.color.getHex() : 0x888888;
          spawnImpact(hit.point, color, b.dir);
          AudioEngine.playImpact(getMaterialType(hit.target), distGain(hit.point));
        }
        world.bullets.splice(i, 1);
        continue;
      }

      b.pos.addScaledVector(b.dir, moveDist);
      if (b.timeAlive > b.maxTime) world.bullets.splice(i, 1);
    }
  }

  function distGain(pos) {
    const dx = pos.x - player.position.x;
    const dy = pos.y - player.position.y;
    const dz = pos.z - player.position.z;
    const d = Math.sqrt(dx*dx + dy*dy + dz*dz);
    return Math.max(0.05, Math.min(1, 25/(d+5)));
  }

  function getMaterialType(obj) {
    if (!obj || !obj.material || !obj.material.color) return 'concrete';
    const hex = obj.material.color.getHex();
    if (hex < 0x333333) return 'metal';
    if (hex > 0x885533 && hex < 0xaa6644) return 'wood';
    return 'concrete';
  }

  function damagePlayer(amount, part, shooter, dir) {
    if (player.dead) return;
    const mult = { head: 2.5, torso: 1, larm: 0.7, rarm: 0.7, lleg: 0.8, rleg: 0.8 };
    let dmg = amount * (mult[part] || 1);

    if (part === 'torso' && player.armor > 0) {
      const abs = Math.min(player.armor, dmg * 0.65);
      player.armor -= abs;
      dmg -= abs;
    }
    player.health -= dmg;
    player.bodyDamage[part] = Math.min(100, (player.bodyDamage[part] || 0) + dmg);
    if (dmg > 15) player.bleeding += 0.4;

    UI.flashDamage(dmg);
    UI.showHitIndicator(dir);
    AudioEngine.playPain();
    AudioEngine.playImpact('flesh');

    if (player.health <= 0) killPlayer(shooter ? `Killed by ${shooter.name}` : 'KIA');
  }

  function killPlayer(reason) {
    if (player.dead) return;
    player.dead = true;
    player.deaths++;
    UI.showDeath(reason || 'Killed in action');
    document.exitPointerLock();
  }

  /* ============== RELOAD / SWITCH ============== */
  function reload() {
    if (player.reloading || player.drawing) return;
    const wk = player.weapons[player.currentSlot];
    if (!wk) return;
    const w = WEAPONS[wk];
    const am = player.ammo[wk];
    if (am.current >= w.magSize || am.reserve <= 0) return;
    // CoD-style class perk: assault reloads 15% faster
    let reloadMul = 1;
    if (player.classKey === 'assault') reloadMul = 0.85;
    player.reloading = true;
    player.reloadStart = performance.now();
    player.reloadEnd = performance.now() + w.reloadTime * 1000 * reloadMul;
    player.reloadDuration = w.reloadTime * 1000 * reloadMul;
    AudioEngine.playReload();
    UI.showReloadProgress && UI.showReloadProgress(true);
  }

  function switchSlot(slot) {
    // Allow primary/secondary weapon swap (have draw animation + view model)
    if (slot === 'primary' || slot === 'secondary') {
      if (!player.weapons[slot]) return;
      if (player.currentSlot === slot) return;
      player.currentSlot = slot;
      player.reloading = false;
      player.drawing = true;
      const w = currentWeapon();
      player.drawEnd = performance.now() + (w?.drawTime || 0.4) * 1000;
      buildWeaponView(w);
      AudioEngine.playClick();
      UI.updateHUD(true);
      UI.flashSlotHud(slot);
      return;
    }
    // Lethal / tactical slot "select" – next G/F throw uses this item & shows HUD highlight
    if (slot === 'lethal') {
      if (player.lethalCount > 0) { UI.flashSlotHud('lethal'); AudioEngine.playClick(); }
      return;
    }
    if (slot === 'tactical') {
      if (player.tacticalCount > 0) { UI.flashSlotHud('tactical'); AudioEngine.playClick(); }
      return;
    }
  }

  /* ============== GRENADES ============== */
  function throwLethal() {
    if (player.lethalCount <= 0) return;
    player.lethalCount--;
    const key = player.weapons.lethal || 'frag';
    throwGrenade(EQUIPMENT[key], false);
    AudioEngine.playGrenadePin();
  }
  function throwTactical() {
    if (player.tacticalCount <= 0) return;
    player.tacticalCount--;
    const key = player.weapons.tactical || 'flash';
    throwGrenade(EQUIPMENT[key], true);
    AudioEngine.playGrenadePin();
  }

  function throwGrenade(eq, isTactical) {
    const origin = camera.position.clone();
    POOL.v1.set(0, 0, -1).applyEuler(camera.rotation);
    const geo = new THREE.SphereGeometry(0.12, 8, 6);
    const mat = new THREE.MeshPhongMaterial({ color: eq.color, shininess: 30 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(origin);
    mesh.castShadow = true;
    scene.add(mesh);
    world.grenades.push({
      mesh, pos: origin,
      velocity: new THREE.Vector3().copy(POOL.v1).multiplyScalar(eq.throwForce).add(new THREE.Vector3(0, 4, 0)),
      timer: eq.fuseTime, eq, isTactical, exploded: false,
      thrower: player,
      spin: new THREE.Vector3((Math.random()-0.5)*10, (Math.random()-0.5)*10, (Math.random()-0.5)*10)
    });
  }

  function updateGrenades(dt) {
    for (let i = world.grenades.length - 1; i >= 0; i--) {
      const g = world.grenades[i];
      g.timer -= dt;
      g.velocity.y -= 15 * dt;
      g.pos.addScaledVector(g.velocity, dt);
      if (g.pos.y < 0.15) {
        g.pos.y = 0.15;
        g.velocity.y *= -0.35;
        g.velocity.x *= 0.7; g.velocity.z *= 0.7;
      }
      g.mesh.position.copy(g.pos);
      g.mesh.rotation.x += g.spin.x * dt;
      g.mesh.rotation.y += g.spin.y * dt;
      g.mesh.rotation.z += g.spin.z * dt;

      if (g.timer <= 0 && !g.exploded) {
        g.exploded = true;
        if (g.eq.type === 'lethal') explode(g.pos, g.eq, g.thrower);
        else if (g.eq.name === 'FLASHBANG') flashbang(g.pos, g.eq);
        else if (g.eq.name === 'SMOKE') createSmoke(g.pos, g.eq);
        scene.remove(g.mesh);
        if (g.mesh.geometry) g.mesh.geometry.dispose();
        if (g.mesh.material) g.mesh.material.dispose();
        world.grenades.splice(i, 1);
      }
    }
  }

  function explode(pos, eq, thrower) {
    AudioEngine.playExplosion();
    const flashLight = new THREE.PointLight(0xffaa44, 8, 25, 2);
    flashLight.position.copy(pos);
    scene.add(flashLight);
    setTimeout(() => scene.remove(flashLight), 200);

    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(eq.radius * 0.4, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffaa44, transparent: true, opacity: 0.9 })
    );
    flash.position.copy(pos);
    scene.add(flash);
    world.particles.push({ mesh: flash, life: 0.6, shrink: false, expand: 0.08 });

    for (let i = 0; i < 15; i++) {
      const s = new THREE.Mesh(
        new THREE.SphereGeometry(0.5 + Math.random() * 0.5, 5, 4),
        new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.7 })
      );
      s.position.copy(pos);
      s.position.x += (Math.random() - 0.5) * eq.radius;
      s.position.y += Math.random() * 3;
      s.position.z += (Math.random() - 0.5) * eq.radius;
      scene.add(s);
      world.particles.push({ mesh: s, life: 2.0, rise: 0.8 });
    }
    for (let i = 0; i < 20; i++) {
      const sp = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 3, 3),
        new THREE.MeshBasicMaterial({ color: 0xffaa00 })
      );
      sp.position.copy(pos);
      const v = new THREE.Vector3((Math.random() - 0.5) * 18, Math.random() * 12, (Math.random() - 0.5) * 18);
      scene.add(sp);
      world.particles.push({ mesh: sp, life: 0.5, velocity: v });
    }

    const checkTarget = (t, isPlayer = false) => {
      const tp = isPlayer ? player.position : t.position;
      const dist = pos.distanceTo(tp);
      if (dist < eq.radius) {
        const falloff = 1 - (dist / eq.radius);
        const dmg = eq.damage * falloff;
        if (isPlayer) {
          damagePlayer(dmg, 'torso', thrower, new THREE.Vector3().subVectors(tp, pos).normalize());
        } else {
          const killed = t.takeDamage(dmg, 'torso', thrower);
          if (killed && thrower === player) {
            player.kills++; missionState.kills++;
            awardXP(120); awardMoney(150);
            UI.addKillfeed('You', t.name, eq.name);
          }
        }
      }
    };
    for (const e of world.enemies) if (!e.dead) checkTarget(e);
    for (const f of world.friendlies) if (!f.dead) checkTarget(f);
    if (!player.dead) checkTarget(null, true);
  }

  function flashbang(pos, eq) {
    AudioEngine.playExplosion();
    const flashLight = new THREE.PointLight(0xffffff, 15, 30, 1);
    flashLight.position.copy(pos);
    scene.add(flashLight);
    setTimeout(() => scene.remove(flashLight), 150);

    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(2.5, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 })
    );
    flash.position.copy(pos);
    scene.add(flash);
    world.particles.push({ mesh: flash, life: 0.4, shrink: true });

    const dist = pos.distanceTo(player.position);
    if (dist < eq.radius) {
      POOL.v1.copy(pos).sub(player.position).normalize();
      POOL.v2.set(0, 0, -1).applyEuler(camera.rotation);
      const dot = POOL.v2.dot(POOL.v1);
      if (dot > -0.4) UI.flashScreen(eq.blindDuration * (1 - dist / eq.radius));
    }
  }

  function createSmoke(pos, eq) {
    for (let i = 0; i < 25; i++) {
      const s = new THREE.Mesh(
        new THREE.SphereGeometry(1 + Math.random() * 0.5, 6, 5),
        new THREE.MeshBasicMaterial({ color: 0xaaaaaa, transparent: true, opacity: 0.55 })
      );
      s.position.copy(pos);
      s.position.x += (Math.random() - 0.5) * eq.radius;
      s.position.y += Math.random() * 2;
      s.position.z += (Math.random() - 0.5) * eq.radius;
      scene.add(s);
      world.particles.push({ mesh: s, life: eq.duration, rise: 0.3, persistent: true });
    }
  }

  /* ============== EFFECTS ============== */
  function spawnMuzzleFlash() {
    if (!weaponMesh) return;
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.10 + Math.random() * 0.04, 5, 4),
      new THREE.MeshBasicMaterial({ color: 0xffdd66, transparent: true, opacity: 1 })
    );
    flash.position.set(0, 0, weaponMesh.userData.muzzleZ - 0.02);
    weaponMesh.add(flash);
    setTimeout(() => {
      weaponMesh && weaponMesh.remove(flash);
      flash.geometry.dispose(); flash.material.dispose();
    }, 50);
    if (muzzleLight) muzzleLight.intensity = 4;
  }

  function spawnBloodHit(pos, dir) {
    for (let i = 0; i < 5; i++) {
      const p = new THREE.Mesh(
        new THREE.SphereGeometry(0.04 + Math.random() * 0.02, 3, 3),
        new THREE.MeshBasicMaterial({ color: 0x880000 })
      );
      p.position.copy(pos);
      const v = new THREE.Vector3().copy(dir).multiplyScalar(2).add(new THREE.Vector3(
        (Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4
      ));
      scene.add(p);
      world.particles.push({ mesh: p, life: 0.5, velocity: v });
    }
  }

  function spawnImpact(pos, color, dir) {
    for (let i = 0; i < 4; i++) {
      const p = new THREE.Mesh(
        new THREE.SphereGeometry(0.025 + Math.random() * 0.02, 3, 3),
        new THREE.MeshBasicMaterial({ color })
      );
      p.position.copy(pos);
      const v = new THREE.Vector3().copy(dir).multiplyScalar(-2).add(new THREE.Vector3(
        (Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3
      ));
      scene.add(p);
      world.particles.push({ mesh: p, life: 0.4, velocity: v });
    }
    for (let i = 0; i < 2; i++) {
      const sp = new THREE.Mesh(
        new THREE.SphereGeometry(0.02, 3, 3),
        new THREE.MeshBasicMaterial({ color: 0xffaa44 })
      );
      sp.position.copy(pos);
      const v = new THREE.Vector3().copy(dir).multiplyScalar(-3).add(new THREE.Vector3(
        (Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4
      ));
      scene.add(sp);
      world.particles.push({ mesh: sp, life: 0.3, velocity: v });
    }
  }

  function updateParticles(dt) {
    // Hard cap (aggressive - particles are pure visual)
    if (world.particles.length > 200) {
      let removed = 0;
      for (let i = 0; i < world.particles.length && removed < 60; i++) {
        const p = world.particles[i];
        if (!p.persistent) {
          scene.remove(p.mesh);
          if (p.mesh.geometry) p.mesh.geometry.dispose();
          if (p.mesh.material) p.mesh.material.dispose();
          world.particles.splice(i, 1);
          i--; removed++;
        }
      }
    }

    for (let i = world.particles.length - 1; i >= 0; i--) {
      const p = world.particles[i];
      p.life -= dt;
      if (p.velocity) {
        p.velocity.y -= 10 * dt;
        p.mesh.position.addScaledVector(p.velocity, dt);
        if (p.mesh.position.y < 0.05) {
          p.mesh.position.y = 0.05;
          p.velocity.set(0, 0, 0);
        }
      }
      if (p.rise) p.mesh.position.y += p.rise * dt;
      if (p.shrink) p.mesh.scale.multiplyScalar(Math.pow(0.3, dt));
      if (p.expand) p.mesh.scale.multiplyScalar(1 + p.expand);
      if (p.mesh.material && !p.persistent) {
        p.mesh.material.opacity = Math.max(0, p.life / 0.5);
      } else if (p.persistent && p.life < 2 && p.mesh.material) {
        p.mesh.material.opacity = (p.life / 2) * 0.55;
      }
      if (p.life <= 0) {
        scene.remove(p.mesh);
        if (p.mesh.geometry) p.mesh.geometry.dispose();
        if (p.mesh.material) p.mesh.material.dispose();
        world.particles.splice(i, 1);
      }
    }
  }

  /* ============== AI UPDATE ============== */
  function updateAI(dt) {
    // Update engagement coordinator (only 1 enemy actively shoots player at a time)
    if (window.Engagement) Engagement.tick(dt, world, player);

    for (const e of world.enemies) {
      try { e.update(dt, world, player); } catch(err) { console.error('AI error', err); e.dead = true; }
    }
    for (const f of world.friendlies) {
      try { f.update(dt, world, player); } catch(err) { console.error('AI error', err); f.dead = true; }
    }

    for (let i = world.enemies.length - 1; i >= 0; i--) {
      const e = world.enemies[i];
      if (e.dead && e.deadTime > 8) {
        disposeSoldier(e);
        world.enemies.splice(i, 1);
      }
    }
    for (let i = world.friendlies.length - 1; i >= 0; i--) {
      const f = world.friendlies[i];
      if (f.dead && !f.counted) { missionState.friendlyDeaths++; f.counted = true; }
      if (f.dead && f.deadTime > 15) {
        disposeSoldier(f);
        world.friendlies.splice(i, 1);
      }
    }
  }

  /* ============== UTILS ============== */
  function bandage() {
    if (player.bleeding <= 0 && player.health >= player.maxHealth) return;
    player.bleeding = 0;
    player.health = Math.min(player.maxHealth, player.health + 30);
    AudioEngine.playClick();
    UI.popupMessage('+30 HP', '#5f5');
  }

  function melee() {
    POOL.v1.set(0, 0, -1).applyEuler(camera.rotation);
    for (const e of world.enemies) {
      if (e.dead) continue;
      const dx = e.position.x - camera.position.x;
      const dz = e.position.z - camera.position.z;
      const dist = Math.sqrt(dx*dx + dz*dz);
      if (dist > 2.4) continue;
      // Check facing
      const fdot = (dx*POOL.v1.x + dz*POOL.v1.z) / dist;
      if (fdot < 0.5) continue;
      const killed = e.takeDamage(90, 'torso', player);
      spawnBloodHit(e.position, POOL.v1);
      AudioEngine.playImpact('flesh');
      if (killed) {
        player.kills++; missionState.kills++;
        awardXP(150); awardMoney(200);
        UI.addKillfeed('You', e.name, 'MELEE');
      }
      break;
    }
  }

  function checkMissionState() {
    if (!currentMission || missionState.ended) return;
    const m = currentMission;
    UI.setObjective(missionObjectiveText(m));
    if (player.dead) return;

    if (m.type === 'tdm' || m.type === 'patrol' || m.type === 'extraction') {
      if (missionState.kills >= m.targetKills) endMission(true);
      const aliveCount = world.enemies.filter(e => !e.dead).length;
      const totalCount = world.enemies.length;
      if (aliveCount < 3 && totalCount < enemyCountSetting + 4) {
        const need = Math.min(2, enemyCountSetting - aliveCount);
        for (let i = 0; i < need; i++) addEnemy();
      }
    } else if (m.type === 'defense' || m.type === 'survival') {
      const alive = world.enemies.filter(e => !e.dead).length;
      if (alive === 0) {
        missionState.wave++;
        if (m.type === 'defense' && missionState.wave >= m.waves) endMission(true);
        else {
          const count = Math.min(10, 4 + missionState.wave * 2);
          spawnEnemies(count);
          awardMoney(300); awardXP(200);
          UI.popupMessage(`WAVE ${missionState.wave + 1} INCOMING`, '#ff5');
        }
      }
    } else if (m.type === 'assassination') {
      if (world.enemies.length > 0 && !world.enemies[0].isHVT) {
        world.enemies[0].isHVT = true;
        world.enemies[0].health *= 2;
        world.enemies[0].maxHealth *= 2;
      }
      const hvt = world.enemies.find(e => e.isHVT);
      if (!hvt || hvt.dead) endMission(true);
    }
  }

  function endMission(success) {
    missionState.ended = true;
    let xpEarned = 0, moneyEarned = 0;
    if (success && currentMission) {
      xpEarned = currentMission.reward.xp;
      moneyEarned = currentMission.reward.money;
      if (currentMission.type === 'survival') {
        xpEarned = currentMission.reward.xp * missionState.wave;
        moneyEarned = currentMission.reward.money * missionState.wave;
      }
      player.xp += xpEarned;
      player.money += moneyEarned;
      player.rank = rankForXP(player.xp);
    }
    UI.showMissionEnd(success, {
      kills: player.kills, deaths: player.deaths,
      friendlies: missionState.friendlyDeaths,
      xp: xpEarned + (player.kills * 100),
      money: moneyEarned + (player.kills * 150),
      time: Math.round(missionState.time)
    });
    document.exitPointerLock();
    savePlayerData();
  }

  function awardXP(amount) {
    player.xp += amount;
    player.rank = rankForXP(player.xp);
    UI.showXPPopup(`+${amount} XP`);
  }
  function awardMoney(amount) {
    player.money += amount;
    UI.showXPPopup(`+$${amount}`, '#5f5');
  }

  function savePlayerData() {
    try {
      localStorage.setItem('blackout_save', JSON.stringify({
        name: player.name, xp: player.xp, money: player.money,
        rank: player.rank, weapons: player.weapons,
        classKey: player.classKey, armorKey: player.armorKey,
        totalKills: (player.totalKills || 0) + player.kills
      }));
    } catch(e) {}
  }
  function loadPlayerData() {
    try {
      const d = JSON.parse(localStorage.getItem('blackout_save') || 'null');
      if (d) {
        player.name = d.name || randomSoldierName('friendly');
        player.xp = d.xp || 0;
        player.money = d.money !== undefined ? d.money : 500;
        player.rank = rankForXP(player.xp);
        player.weapons = d.weapons || { primary: 'm4a1', secondary: 'm9', lethal: 'frag', tactical: 'flash' };
        player.classKey = d.classKey || 'assault';
        player.armorKey = d.armorKey || 'medium';
        player.totalKills = d.totalKills || 0;
      } else {
        player.name = randomSoldierName('friendly');
        player.weapons = { primary: 'm4a1', secondary: 'm9', lethal: 'frag', tactical: 'flash' };
      }
    } catch(e) {
      player.name = randomSoldierName('friendly');
      player.weapons = { primary: 'm4a1', secondary: 'm9', lethal: 'frag', tactical: 'flash' };
    }
  }

  function setSettings(s) {
    if (s.sens !== undefined) mouseSens = s.sens;
    if (s.fov !== undefined) baseFov = s.fov;
    if (s.invertY !== undefined) invertY = s.invertY;
    if (s.showFPS !== undefined) showFPSCounter = s.showFPS;
    if (s.volume !== undefined) AudioEngine.setVolume(s.volume);
  }

  function getPlayer() { return player; }
  function getWorld() { return world; }
  function getMissionState() { return missionState; }

  function pause() { missionState.paused = true; }
  function resume() { missionState.paused = false; }

  // Expose internals for polish.js to override visuals
  function getScene() { return scene; }
  function getCamera() { return camera; }
  function getKeys() { return keys; }
  function getWeaponMesh() { return weaponMesh; }
  function setWeaponMesh(m) { weaponMesh = m; }

  return {
    init, startMission, endMission, pause, resume,
    getPlayer, getWorld, getMissionState,
    loadPlayerData, savePlayerData, setSettings,
    fireBullet, currentWeapon, awardXP, awardMoney,
    world, player,
    getScene, getCamera, getKeys, getWeaponMesh, setWeaponMesh,
    buildWeaponView  // expose for polish override
  };
})();

window.Game = Game;
