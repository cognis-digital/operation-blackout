/* ============================================================
   UI HANDLER — Menus, HUD, Radar, Settings
   ============================================================ */

const UI = (() => {
  let selectedMission = null;
  let loadout = { primary: 'm4a1', secondary: 'm9', lethal: 'frag', tactical: 'flash', armor: 'medium', classKey: 'assault' };
  let scoreboardOpen = false;
  let mapOpen = false;
  let radarCtx = null;
  let bigMapCtx = null;

  function init() {
    const canvas = document.getElementById('gameCanvas');
    Game.init(canvas);
    Game.loadPlayerData();
    loadSettings();

    // Sync loadout from player
    const p = Game.getPlayer();
    loadout.primary = p.weapons.primary;
    loadout.secondary = p.weapons.secondary;
    loadout.lethal = p.weapons.lethal;
    loadout.tactical = p.weapons.tactical;
    loadout.armor = p.armorKey;
    loadout.classKey = p.classKey;

    refreshMainMenu();
    setupMissionList();
    setupLoadout();
    setupSettings();

    radarCtx = document.getElementById('radarCanvas').getContext('2d');
    bigMapCtx = document.getElementById('bigMapCanvas').getContext('2d');
  }

  /* ============== MAIN MENU ============== */
  function refreshMainMenu() {
    const p = Game.getPlayer();
    document.getElementById('menuSoldierName').textContent = `${p.rank.name}. ${p.name.toUpperCase()}`;
    document.getElementById('menuRankBadge').textContent = p.rank.name;
    document.getElementById('menuXP').textContent = p.xp;
    document.getElementById('menuMoney').textContent = p.money;
    document.getElementById('menuKD').textContent = `${p.totalKills}/${p.deaths}`;

    // XP bar progress
    const cur = p.rank.minXP;
    const next = RANKS.find(r => r.minXP > cur);
    if (next) {
      const pct = ((p.xp - cur) / (next.minXP - cur)) * 100;
      document.getElementById('menuXpFill').style.width = `${Math.min(100, pct)}%`;
    } else {
      document.getElementById('menuXpFill').style.width = '100%';
    }
  }

  /* ============== MISSION SELECT ============== */
  function setupMissionList() {
    const list = document.getElementById('missionList');
    list.innerHTML = '';
    MISSIONS.forEach((m, i) => {
      const card = document.createElement('div');
      card.className = 'missionCard';
      if (i === 0) { card.classList.add('selected'); selectedMission = m; }
      card.innerHTML = `
        <h4>${m.name}</h4>
        <div class="desc">${m.desc}</div>
        <div class="meta">MAP: ${m.map.toUpperCase()} • REWARD: ${m.reward.xp} XP / $${m.reward.money}</div>
      `;
      card.onclick = () => {
        document.querySelectorAll('.missionCard').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedMission = m;
      };
      list.appendChild(card);
    });

    document.getElementById('enemyCount').oninput = (e) => {
      document.getElementById('enemyCountVal').textContent = e.target.value;
    };
    document.getElementById('startMissionBtn').onclick = () => {
      if (!selectedMission) return;
      AudioEngine.init(); AudioEngine.resume();
      hideAllMenus();
      Game.startMission(selectedMission, {
        primary: loadout.primary,
        secondary: loadout.secondary,
        lethal: loadout.lethal,
        tactical: loadout.tactical
      });
      const p = Game.getPlayer();
      p.classKey = loadout.classKey;
      p.armorKey = loadout.armor;
    };
  }

  /* ============== LOADOUT ============== */
  function setupLoadout() {
    refreshLoadout();
  }
  function refreshLoadout() {
    const p = Game.getPlayer();
    // Classes
    const cl = document.getElementById('classList');
    cl.innerHTML = '';
    Object.entries(CLASSES).forEach(([key, c]) => {
      const item = document.createElement('div');
      item.className = 'loadoutItem' + (loadout.classKey === key ? ' selected' : '');
      item.innerHTML = `<div><b>${c.icon} ${c.name}</b><br><small>${c.perk}</small></div>`;
      item.onclick = () => {
        loadout.classKey = key;
        // Apply default loadout
        Object.assign(loadout, c.defaultLoadout);
        refreshLoadout();
      };
      cl.appendChild(item);
    });

    // Primary weapons
    fillWeaponList('primaryList', 'primary');
    fillWeaponList('secondaryList', 'secondary');

    // Lethal / Tactical
    const gl = document.getElementById('gearList');
    gl.innerHTML = '';
    Object.entries(EQUIPMENT).forEach(([key, e]) => {
      const item = document.createElement('div');
      const slot = e.type;
      const isSelected = (slot === 'lethal' ? loadout.lethal : loadout.tactical) === key;
      const unlocked = !e.unlockXP || p.xp >= e.unlockXP;
      item.className = 'loadoutItem' + (isSelected ? ' selected' : '') + (unlocked ? '' : ' locked');
      item.innerHTML = `
        <div><b>${e.name}</b><br><small style="color:#888">${e.type.toUpperCase()}</small></div>
        ${e.price > 0 ? `<span class="price">$${e.price}</span>` : ''}
      `;
      item.onclick = () => {
        if (!unlocked) return;
        if (slot === 'lethal') loadout.lethal = key; else loadout.tactical = key;
        refreshLoadout();
      };
      gl.appendChild(item);
    });

    // Armor
    const ar = document.getElementById('armorList');
    ar.innerHTML = '';
    Object.entries(ARMOR).forEach(([key, a]) => {
      const unlocked = !a.unlockXP || p.xp >= a.unlockXP;
      const item = document.createElement('div');
      item.className = 'loadoutItem' + (loadout.armor === key ? ' selected' : '') + (unlocked ? '' : ' locked');
      item.innerHTML = `
        <div><b>${a.name}</b><br><small>HP: +${a.hp}</small></div>
        ${a.price > 0 ? `<span class="price">$${a.price}</span>` : ''}
      `;
      item.onclick = () => {
        if (!unlocked) return;
        loadout.armor = key;
        refreshLoadout();
      };
      ar.appendChild(item);
    });

    // Stats panel for currently equipped primary
    showWeaponStats(WEAPONS[loadout.primary]);
  }

  function fillWeaponList(elId, slot) {
    const el = document.getElementById(elId);
    el.innerHTML = '';
    const p = Game.getPlayer();
    Object.entries(WEAPONS).filter(([k,w]) => w.slot === slot).forEach(([key, w]) => {
      const unlocked = !w.unlockXP || p.xp >= w.unlockXP || w.price === 0;
      const isSelected = loadout[slot] === key;
      const item = document.createElement('div');
      item.className = 'loadoutItem' + (isSelected ? ' selected' : '') + (unlocked ? '' : ' locked');
      item.innerHTML = `
        <div><b>${w.name}</b><br><small style="color:#888">${w.class.toUpperCase()}</small></div>
        ${w.price > 0 ? `<span class="price">${unlocked ? 'OWNED' : 'Lvl ' + w.unlockXP + ' XP'}</span>` : ''}
      `;
      item.onclick = () => {
        if (!unlocked) return;
        loadout[slot] = key;
        refreshLoadout();
      };
      item.onmouseenter = () => showWeaponStats(w);
      el.appendChild(item);
    });
  }

  function showWeaponStats(w) {
    if (!w) return;
    const el = document.getElementById('weaponStats');
    const bar = (label, val, max) => {
      const pct = Math.min(100, (val / max) * 100);
      return `<div class="statBar"><span>${label}</span><div class="bar"><div style="width:${pct}%"></div></div></div>`;
    };
    el.innerHTML = `
      <b>${w.name}</b><br>
      <small style="color:#888">${w.desc}</small>
      ${bar('DAMAGE', w.damage, 200)}
      ${bar('RPM', w.rpm, 1200)}
      ${bar('RANGE', w.range, 320)}
      ${bar('ACCURACY', 100 - w.spread.ads * 1000, 100)}
      ${bar('MAG', w.magSize, 50)}
      ${bar('PEN', w.armorPen * 100, 100)}
      <div style="margin-top:6px; color:#aaa; font-size:11px">
        FIRE: ${w.fireModes.join(' / ').toUpperCase()} • RELOAD: ${w.reloadTime}s
      </div>
    `;
  }

  /* ============== SETTINGS ============== */
  function setupSettings() {
    document.getElementById('sensSlider').oninput = (e) => {
      document.getElementById('sensVal').textContent = parseFloat(e.target.value).toFixed(1);
      Game.setSettings({ sens: parseFloat(e.target.value) });
      saveSettings();
    };
    document.getElementById('fovSlider').oninput = (e) => {
      document.getElementById('fovVal').textContent = e.target.value;
      Game.setSettings({ fov: parseInt(e.target.value) });
      saveSettings();
    };
    document.getElementById('volSlider').oninput = (e) => {
      const v = parseFloat(e.target.value);
      document.getElementById('volVal').textContent = Math.round(v * 100) + '%';
      Game.setSettings({ volume: v });
      saveSettings();
    };
    document.getElementById('invertY').onchange = (e) => {
      Game.setSettings({ invertY: e.target.checked });
      saveSettings();
    };
    document.getElementById('showFPS').onchange = (e) => {
      Game.setSettings({ showFPS: e.target.checked });
      document.getElementById('fpsDisplay').style.display = e.target.checked ? 'block' : 'none';
      saveSettings();
    };
  }

  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem('blackout_settings') || 'null');
      if (s) {
        document.getElementById('sensSlider').value = s.sens || 2;
        document.getElementById('sensVal').textContent = (s.sens || 2).toFixed(1);
        document.getElementById('fovSlider').value = s.fov || 80;
        document.getElementById('fovVal').textContent = s.fov || 80;
        document.getElementById('volSlider').value = s.volume !== undefined ? s.volume : 0.7;
        document.getElementById('volVal').textContent = Math.round((s.volume !== undefined ? s.volume : 0.7) * 100) + '%';
        document.getElementById('invertY').checked = !!s.invertY;
        document.getElementById('showFPS').checked = s.showFPS !== false;
        Game.setSettings(s);
      } else {
        Game.setSettings({ sens: 2, fov: 80, volume: 0.7, invertY: false, showFPS: true });
      }
    } catch(e) {}
  }
  function saveSettings() {
    const s = {
      sens: parseFloat(document.getElementById('sensSlider').value),
      fov: parseInt(document.getElementById('fovSlider').value),
      volume: parseFloat(document.getElementById('volSlider').value),
      invertY: document.getElementById('invertY').checked,
      showFPS: document.getElementById('showFPS').checked
    };
    try { localStorage.setItem('blackout_settings', JSON.stringify(s)); } catch(e) {}
  }

  /* ============== MENU NAV ============== */
  function hideAllMenus() {
    ['mainMenu','missionMenu','loadoutMenu','settingsMenu','controlsMenu'].forEach(id =>
      document.getElementById(id).classList.add('hidden')
    );
  }
  function showMain() {
    hideAllMenus();
    document.getElementById('gameContainer').classList.add('hidden');
    document.getElementById('mainMenu').classList.remove('hidden');
    refreshMainMenu();
  }
  function openMissionSelect() {
    hideAllMenus();
    document.getElementById('missionMenu').classList.remove('hidden');
  }
  function openLoadout() {
    hideAllMenus();
    document.getElementById('loadoutMenu').classList.remove('hidden');
    refreshLoadout();
  }
  function openSettings(fromGame = false) {
    if (fromGame) {
      document.getElementById('pauseMenu').classList.add('hidden');
    } else {
      hideAllMenus();
    }
    document.getElementById('settingsMenu').classList.remove('hidden');
  }
  function openControls(fromGame = false) {
    if (fromGame) {
      document.getElementById('pauseMenu').classList.add('hidden');
    } else {
      hideAllMenus();
    }
    document.getElementById('controlsMenu').classList.remove('hidden');
  }
  function backToMain() {
    // If game is running, go back to pause menu
    if (!document.getElementById('gameContainer').classList.contains('hidden') && Game.getMissionState().paused) {
      hideAllMenus();
      document.getElementById('pauseMenu').classList.remove('hidden');
      return;
    }
    showMain();
  }
  function saveLoadout() {
    const p = Game.getPlayer();
    p.weapons.primary = loadout.primary;
    p.weapons.secondary = loadout.secondary;
    p.weapons.lethal = loadout.lethal;
    p.weapons.tactical = loadout.tactical;
    p.armorKey = loadout.armor;
    p.classKey = loadout.classKey;
    Game.savePlayerData();
    backToMain();
  }

  function showGame() {
    hideAllMenus();
    document.getElementById('gameContainer').classList.remove('hidden');
    document.getElementById('pauseMenu').classList.add('hidden');
    document.getElementById('missionEnd').classList.add('hidden');
    document.getElementById('deathScreen').classList.add('hidden');
  }

  function pauseGame() {
    if (Game.getMissionState().ended) return;
    Game.pause();
    document.getElementById('pauseMenu').classList.remove('hidden');
  }
  function resumeGame() {
    document.getElementById('pauseMenu').classList.add('hidden');
    Game.resume();
    document.getElementById('gameCanvas').requestPointerLock();
  }
  function endMission() {
    document.getElementById('missionEnd').classList.add('hidden');
    document.getElementById('deathScreen').classList.add('hidden');
    document.getElementById('pauseMenu').classList.add('hidden');
    showMain();
  }

  function showMissionEnd(success, stats) {
    document.getElementById('missionEnd').classList.remove('hidden');
    document.getElementById('endTitle').textContent = success ? 'MISSION COMPLETE' : 'MISSION FAILED';
    document.getElementById('endTitle').style.color = success ? '#5f5' : '#f55';
    document.getElementById('endStats').innerHTML = `
      <div class="row"><span>KILLS</span><b>${stats.kills}</b></div>
      <div class="row"><span>DEATHS</span><b>${stats.deaths}</b></div>
      <div class="row"><span>FRIENDLY KIA</span><b>${stats.friendlies}</b></div>
      <div class="row"><span>TIME</span><b>${formatTime(stats.time)}</b></div>
      <div class="row"><span>XP EARNED</span><b style="color:#ff5">+${stats.xp}</b></div>
      <div class="row"><span>MONEY</span><b style="color:#5f5">+$${stats.money}</b></div>
    `;
  }
  function showDeath(reason) {
    document.getElementById('deathScreen').classList.remove('hidden');
    document.getElementById('deathReason').textContent = reason;
  }
  function formatTime(s) {
    const m = Math.floor(s / 60), sec = s % 60;
    return `${m}:${sec.toString().padStart(2,'0')}`;
  }

  /* ============== HUD UPDATES (cached refs + change-detection) ============== */
  let hudCache = {};
  let hudEls = null;
  function getHudEls() {
    if (hudEls) return hudEls;
    hudEls = {
      weaponName: document.getElementById('weaponName'),
      ammoCurrent: document.getElementById('ammoCurrent'),
      ammoReserve: document.getElementById('ammoReserve'),
      fireMode: document.getElementById('fireMode'),
      hpText: document.getElementById('hpText'),
      armorText: document.getElementById('armorText'),
      hpBar: document.getElementById('hpBar'),
      armorBar: document.getElementById('armorBar'),
      lethalCount: document.getElementById('lethalCount'),
      tacticalCount: document.getElementById('tacticalCount'),
      bleedIndicator: document.getElementById('bleedIndicator'),
      bp: {
        head: document.getElementById('bp-head'),
        torso: document.getElementById('bp-torso'),
        larm: document.getElementById('bp-larm'),
        rarm: document.getElementById('bp-rarm'),
        lleg: document.getElementById('bp-lleg'),
        rleg: document.getElementById('bp-rleg')
      }
    };
    return hudEls;
  }

  function updateHUD(force = false) {
    const p = Game.getPlayer();
    const w = Game.currentWeapon();
    if (!w) return;
    const els = getHudEls();
    const am = p.ammo[p.weapons[p.currentSlot]];

    // Only update DOM if value changed
    if (hudCache.weaponName !== w.name) { els.weaponName.textContent = w.name; hudCache.weaponName = w.name; }
    const ac = am ? am.current : 0, ar = am ? am.reserve : 0;
    if (hudCache.ammoCurrent !== ac) { els.ammoCurrent.textContent = ac; hudCache.ammoCurrent = ac; }
    if (hudCache.ammoReserve !== ar) { els.ammoReserve.textContent = ar; hudCache.ammoReserve = ar; }
    const fm = w.fireModes[p.fireMode].toUpperCase();
    if (hudCache.fireMode !== fm || force) { els.fireMode.textContent = fm; hudCache.fireMode = fm; }

    const hp = Math.max(0, Math.round(p.health));
    if (hudCache.hp !== hp) {
      els.hpText.textContent = hp;
      els.hpBar.style.width = (p.health / p.maxHealth * 100) + '%';
      hudCache.hp = hp;
    }
    const ar2 = Math.max(0, Math.round(p.armor));
    if (hudCache.armor !== ar2) {
      els.armorText.textContent = ar2;
      els.armorBar.style.width = (p.maxArmor > 0 ? (p.armor / p.maxArmor * 100) : 0) + '%';
      hudCache.armor = ar2;
    }

    if (hudCache.lethal !== p.lethalCount) { els.lethalCount.textContent = p.lethalCount; hudCache.lethal = p.lethalCount; }
    if (hudCache.tac !== p.tacticalCount) { els.tacticalCount.textContent = p.tacticalCount; hudCache.tac = p.tacticalCount; }

    // Body part damage (cached)
    const parts = ['head','torso','larm','rarm','lleg','rleg'];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const el = els.bp[part];
      if (!el) continue;
      const d = p.bodyDamage[part] || 0;
      let cls = d > 60 ? 'dmg3' : d > 30 ? 'dmg2' : d > 10 ? 'dmg1' : '';
      const cacheKey = 'bp_' + part;
      if (hudCache[cacheKey] !== cls) {
        el.classList.remove('dmg1','dmg2','dmg3');
        if (cls) el.classList.add(cls);
        hudCache[cacheKey] = cls;
      }
    }

    const bleeding = p.bleeding > 0;
    if (hudCache.bleeding !== bleeding) {
      els.bleedIndicator.classList.toggle('hidden', !bleeding);
      hudCache.bleeding = bleeding;
    }

    // ===== Hotbar (1234 slots) =====
    updateHotbar(p);

    // ===== Stamina bar =====
    const sb = document.getElementById('staminaBar');
    const sf = document.getElementById('staminaFill');
    if (sb && sf) {
      const pct = (p.stamina / (p.maxStamina || 100)) * 100;
      sf.style.width = pct + '%';
      sb.classList.toggle('low', pct < 30);
    }

    // ===== Reload progress bar =====
    const rb = document.getElementById('reloadBar');
    const rf = document.getElementById('reloadFill');
    if (rb && rf) {
      if (p.reloading) {
        const t = Math.min(1, (performance.now() - p.reloadStart) / p.reloadDuration);
        rf.style.width = (t * 100) + '%';
        rb.classList.remove('hidden');
      } else if (p.drawing) {
        const wd = (Game.currentWeapon()?.drawTime || 0.4) * 1000;
        const t = Math.min(1, 1 - (p.drawEnd - performance.now()) / wd);
        rf.style.width = (t * 100) + '%';
        rb.classList.remove('hidden');
        rb.querySelector('span').textContent = 'DRAWING';
      } else {
        rb.classList.add('hidden');
        rb.querySelector('span').textContent = 'RELOADING';
      }
    }
  }

  function updateHotbar(p) {
    const slots = ['primary', 'secondary', 'lethal', 'tactical'];
    const ids = ['hot1', 'hot2', 'hot3', 'hot4'];
    const containers = document.querySelectorAll('.hotSlot');
    slots.forEach((slot, i) => {
      const el = document.getElementById(ids[i]);
      if (!el) return;
      let label = '—';
      if (slot === 'primary' || slot === 'secondary') {
        const wk = p.weapons[slot];
        if (wk && WEAPONS[wk]) label = WEAPONS[wk].name.split(' ')[0];
      } else if (slot === 'lethal') {
        const lk = p.weapons.lethal;
        label = (EQUIPMENT[lk]?.name || 'FRAG') + ' ×' + p.lethalCount;
      } else if (slot === 'tactical') {
        const tk = p.weapons.tactical;
        label = (EQUIPMENT[tk]?.name || 'FLASH') + ' ×' + p.tacticalCount;
      }
      el.textContent = label;
      // Active highlight
      if (containers[i]) {
        containers[i].classList.toggle('active', p.currentSlot === slot);
      }
    });
  }

  function flashSlotHud(slot) {
    const map = { primary: 0, secondary: 1, lethal: 2, tactical: 3 };
    const idx = map[slot]; if (idx === undefined) return;
    const el = document.querySelectorAll('.hotSlot')[idx];
    if (!el) return;
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }

  function showReloadProgress(show) {
    const rb = document.getElementById('reloadBar');
    if (rb) rb.classList.toggle('hidden', !show);
  }

  function updateFPS(fps) {
    document.getElementById('fpsDisplay').textContent = `FPS: ${fps}`;
  }

  function setObjective(text) {
    document.getElementById('objText').textContent = text;
  }

  let lastKillfeed = 0;
  function addKillfeed(killer, victim, weapon, headshot = false) {
    const kf = document.getElementById('killfeed');
    const entry = document.createElement('div');
    entry.className = 'killEntry';
    entry.innerHTML = `<span class="killer">${killer}</span> [${weapon}${headshot ? ' 🎯' : ''}] <span class="victim">${victim}</span>`;
    kf.appendChild(entry);
    setTimeout(() => entry.remove(), 6000);
    if (kf.children.length > 5) kf.removeChild(kf.firstChild);
  }

  function showXPPopup(text, color = '#ff5') {
    const div = document.createElement('div');
    div.className = 'xpPopup';
    div.style.color = color;
    div.textContent = text;
    document.getElementById('xpPopups').appendChild(div);
    setTimeout(() => div.remove(), 1500);
  }

  function showHitMarker(kill = false) {
    const m = document.getElementById('hitMarker');
    m.classList.remove('hidden');
    m.classList.toggle('kill', kill);
    clearTimeout(m._t);
    m._t = setTimeout(() => m.classList.add('hidden'), kill ? 400 : 200);
  }

  function flashCrosshairSpread() {
    const c = document.getElementById('crosshair');
    c.classList.add('spread');
    clearTimeout(c._t);
    c._t = setTimeout(() => c.classList.remove('spread'), 80);
  }

  function flashDamage(amount) {
    const v = document.getElementById('damageVignette');
    const intensity = Math.min(80, amount * 2);
    v.style.boxShadow = `inset 0 0 80px rgba(255,0,0,${intensity/100})`;
    setTimeout(() => { v.style.boxShadow = `inset 0 0 80px rgba(255,0,0,0)`; }, 400);

    const blood = document.getElementById('bloodOverlay');
    blood.style.background = `radial-gradient(ellipse at center, transparent 40%, rgba(120,0,0,${Math.min(0.5, amount/200)}) 100%)`;
    setTimeout(() => { blood.style.background = ''; }, 800);
  }

  function flashScreen(duration) {
    const f = document.getElementById('flashOverlay');
    f.style.transition = 'none';
    f.style.opacity = '1';
    setTimeout(() => {
      f.style.transition = `opacity ${duration}s`;
      f.style.opacity = '0';
    }, 30);
  }

  function showHitIndicator(dir) {
    if (!dir) return;
    const p = Game.getPlayer();
    const playerForward = new THREE.Vector3(Math.sin(p.rotation.yaw), 0, Math.cos(p.rotation.yaw));
    const inv = dir.clone().negate();
    inv.y = 0;
    const angle = Math.atan2(playerForward.x, playerForward.z) - Math.atan2(inv.x, inv.z);
    const arrow = document.createElement('div');
    arrow.className = 'hitArrow';
    arrow.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
    document.getElementById('hitIndicators').appendChild(arrow);
    setTimeout(() => arrow.remove(), 1000);
  }

  function showScope(show, zoom) {
    document.getElementById('scopeOverlay').classList.toggle('hidden', !show);
    document.getElementById('crosshair').classList.toggle('hidden', show);
    if (show && zoom) {
      const z = document.getElementById('scopeZoom');
      if (z) z.textContent = 'ZOOM ×' + (zoom < 10 ? zoom.toFixed(1) : zoom.toFixed(0));
    }
  }

  function popupMessage(text, color = '#ff5') {
    const div = document.createElement('div');
    div.className = 'xpPopup';
    div.style.color = color;
    div.style.fontSize = '20px';
    div.textContent = text;
    document.getElementById('xpPopups').appendChild(div);
    setTimeout(() => div.remove(), 2000);
  }

  /* ============== COMPASS (build string ONCE, just translate) ============== */
  let compassStrip = null;
  let compassBuilt = false;
  function buildCompassStrip() {
    compassStrip = document.getElementById('compassStrip');
    if (!compassStrip) return;
    const chars = [];
    const degPerChar = 4;
    for (let d = -180; d <= 540; d += degPerChar) {
      const a = ((d % 360) + 360) % 360;
      if (a === 0) chars.push('N');
      else if (a === 45) chars.push('NE');
      else if (a === 90) chars.push('E');
      else if (a === 135) chars.push('SE');
      else if (a === 180) chars.push('S');
      else if (a === 225) chars.push('SW');
      else if (a === 270) chars.push('W');
      else if (a === 315) chars.push('NW');
      else if (a % 30 === 0) chars.push('|');
      else chars.push('·');
    }
    compassStrip.textContent = chars.join('');
    compassBuilt = true;
  }

  function updateCompass(yaw) {
    if (!compassBuilt) buildCompassStrip();
    if (!compassStrip) return;
    const degYaw = ((-yaw * 180 / Math.PI) % 360 + 360) % 360;
    compassStrip.style.transform = `translateX(${-degYaw * 1.78 - 60}px)`;
  }

  /* ============== RADAR (optimized) ============== */
  function updateRadar(world, player) {
    if (!radarCtx) return;
    const ctx = radarCtx;
    const W = 180, H = 180, cx = W/2, cy = H/2;
    ctx.clearRect(0,0,W,H);

    ctx.fillStyle = 'rgba(20,40,20,.7)';
    ctx.beginPath(); ctx.arc(cx, cy, 88, 0, Math.PI*2); ctx.fill();

    ctx.strokeStyle = 'rgba(0,255,0,.3)'; ctx.lineWidth = 1;
    for (let r = 22; r <= 88; r += 22) {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(cx, cy-88); ctx.lineTo(cx, cy+88);
    ctx.moveTo(cx-88, cy); ctx.lineTo(cx+88, cy); ctx.stroke();

    const scale = 88 / 60;
    const yawCos = Math.cos(-player.rotation.yaw);
    const yawSin = Math.sin(-player.rotation.yaw);
    const radiusSq = 88 * 88;

    // Obstacles — only nearby ones, batched
    ctx.fillStyle = 'rgba(140,140,140,.35)';
    const obstacles = world.obstacles;
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      const dx = o.position.x - player.position.x;
      const dz = o.position.z - player.position.z;
      // 2D distance cull first (cheaper than rotate)
      if (dx*dx + dz*dz > 3600) continue;  // > 60m
      const rx = dx * yawCos - dz * yawSin;
      const rz = dx * yawSin + dz * yawCos;
      const sx = rx * scale, sz = rz * scale;
      if (sx*sx + sz*sz < radiusSq) {
        ctx.fillRect(cx + sx - 1, cy + sz - 1, 2, 2);
      }
    }

    // Enemies (red triangles)
    for (const e of world.enemies) {
      if (e.dead) continue;
      const dx = e.position.x - player.position.x;
      const dz = e.position.z - player.position.z;
      const rx = dx * yawCos - dz * yawSin;
      const rz = dx * yawSin + dz * yawCos;
      const dist = Math.sqrt(rx*rx + rz*rz);
      if (dist * scale < 88) {
        const px = cx + rx * scale;
        const py = cy + rz * scale;
        // Only show if alerted (engagement) or if player is veteran etc
        ctx.fillStyle = e.target === player ? '#f44' : 'rgba(220,40,40,.7)';
        ctx.beginPath();
        ctx.moveTo(px, py-4);
        ctx.lineTo(px-3, py+3);
        ctx.lineTo(px+3, py+3);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Friendlies (blue circles)
    for (const f of world.friendlies) {
      if (f.dead) continue;
      const dx = f.position.x - player.position.x;
      const dz = f.position.z - player.position.z;
      const rx = dx * yawCos - dz * yawSin;
      const rz = dx * yawSin + dz * yawCos;
      const dist = Math.sqrt(rx*rx + rz*rz);
      if (dist * scale < 88) {
        const px = cx + rx * scale;
        const py = cy + rz * scale;
        ctx.fillStyle = '#5cf';
        ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI*2); ctx.fill();
      }
    }

    // Player at center (arrow up)
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(cx, cy-6);
    ctx.lineTo(cx-4, cy+4);
    ctx.lineTo(cx+4, cy+4);
    ctx.closePath();
    ctx.fill();

    // N marker at top
    ctx.fillStyle = '#ff5';
    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'center';
    // Rotate the N to show actual north relative to player heading
    const nAngle = player.rotation.yaw;
    const nx = cx + Math.sin(nAngle) * 80;
    const ny = cy - Math.cos(nAngle) * 80;
    ctx.fillText('N', nx, ny);
  }

  function toggleMap() {
    mapOpen = !mapOpen;
    document.getElementById('bigMap').classList.toggle('hidden', !mapOpen);
    if (mapOpen) {
      drawBigMap();
      Game.pause();
    } else {
      Game.resume();
      document.getElementById('gameCanvas').requestPointerLock();
    }
  }
  function drawBigMap() {
    const ctx = bigMapCtx;
    const W = 500, H = 500;
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle = '#0a1208'; ctx.fillRect(0,0,W,H);
    // grid
    ctx.strokeStyle = 'rgba(0,255,0,.1)';
    for (let i = 0; i <= W; i += 50) {
      ctx.beginPath(); ctx.moveTo(i,0); ctx.lineTo(i,H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0,i); ctx.lineTo(W,i); ctx.stroke();
    }
    const w = Game.getWorld();
    const p = Game.getPlayer();
    const scale = W / 250;
    const cx = W/2, cy = H/2;
    // obstacles
    ctx.fillStyle = '#556';
    for (const o of w.obstacles) {
      const box = new THREE.Box3().setFromObject(o);
      const sx = (box.max.x - box.min.x) * scale;
      const sz = (box.max.z - box.min.z) * scale;
      ctx.fillRect(cx + o.position.x * scale - sx/2, cy + o.position.z * scale - sz/2, sx, sz);
    }
    // enemies
    for (const e of w.enemies) {
      if (e.dead) continue;
      ctx.fillStyle = '#f44';
      ctx.beginPath();
      ctx.arc(cx + e.position.x * scale, cy + e.position.z * scale, 4, 0, Math.PI*2);
      ctx.fill();
    }
    for (const f of w.friendlies) {
      if (f.dead) continue;
      ctx.fillStyle = '#5cf';
      ctx.beginPath();
      ctx.arc(cx + f.position.x * scale, cy + f.position.z * scale, 4, 0, Math.PI*2);
      ctx.fill();
    }
    // player
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx + p.position.x * scale, cy + p.position.z * scale, 5, 0, Math.PI*2);
    ctx.fill();
    // Heading
    const hx = Math.sin(p.rotation.yaw) * 12;
    const hz = Math.cos(p.rotation.yaw) * 12;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx + p.position.x * scale, cy + p.position.z * scale);
    ctx.lineTo(cx + p.position.x * scale + hx, cy + p.position.z * scale + hz);
    ctx.stroke();
  }

  function toggleScoreboard(show) {
    document.getElementById('scoreboard').classList.toggle('hidden', !show);
    if (show) refreshScoreboard();
  }
  function refreshScoreboard() {
    const tbody = document.querySelector('#scoreTable tbody');
    tbody.innerHTML = '';
    const p = Game.getPlayer();
    const w = Game.getWorld();
    const add = (name, kills, deaths, status, cls) => {
      const tr = document.createElement('tr');
      tr.className = (status === 'KIA' ? 'dead ' : '') + cls;
      tr.innerHTML = `<td>${name}</td><td>${kills}</td><td>${deaths}</td><td>${status}</td>`;
      tbody.appendChild(tr);
    };
    add(`★ ${p.rank.name}. ${p.name} (You)`, p.kills, p.deaths, p.dead ? 'KIA' : 'ALIVE', 'friendly');
    for (const f of w.friendlies) {
      add(`${f.rank ? f.rank.name + '. ' : ''}${f.name}`, f.shotsFired ? Math.floor(f.shotsFired/8) : 0, f.dead ? 1 : 0, f.dead ? 'KIA' : 'ALIVE', 'friendly');
    }
    add('', '', '', '', '');
    for (const e of w.enemies) {
      add(e.name, e.shotsFired ? Math.floor(e.shotsFired/10) : 0, e.dead ? 1 : 0, e.dead ? 'KIA' : 'ALIVE', 'enemy');
    }
  }

  return {
    init, showGame, showMain, openMissionSelect, openLoadout, openSettings, openControls,
    backToMain, saveLoadout, pauseGame, resumeGame, endMission,
    updateHUD, updateFPS, updateRadar, updateCompass,
    setObjective, addKillfeed, showXPPopup, showHitMarker, flashCrosshairSpread,
    flashDamage, flashScreen, showHitIndicator, showScope, showMissionEnd, showDeath,
    toggleMap, toggleScoreboard, popupMessage,
    flashSlotHud, showReloadProgress
  };
})();

window.UI = UI;
window.addEventListener('load', () => UI.init());
