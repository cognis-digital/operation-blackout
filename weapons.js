/* ============================================================
   WEAPONS CATALOG — Real weapon archetypes
   Stats: damage, RPM, recoil, accuracy, range, mag, reserve
   ============================================================ */

const WEAPONS = {
  /* ========== ASSAULT RIFLES ========== */
  m4a1: {
    name: 'M4A1 CARBINE', class: 'ar', slot: 'primary',
    damage: 28, headMult: 2.5, armorPen: 0.55,
    rpm: 750, recoil: { v: 0.018, h: 0.012 },
    spread: { hip: 0.04, ads: 0.005, move: 0.06 },
    range: 80, velocity: 880,
    magSize: 30, reserve: 120,
    reloadTime: 2.2, drawTime: 0.5,
    fireModes: ['auto', 'burst', 'semi'],
    adsTime: 0.25, adsFovMult: 0.65,
    color: 0x2a2a2a, length: 0.85, barrelLen: 0.4,
    sound: 'rifle1', price: 0, unlockXP: 0,
    desc: 'Versatile 5.56mm carbine. Balanced damage, controllable recoil.'
  },
  ak47: {
    name: 'AK-47', class: 'ar', slot: 'primary',
    damage: 38, headMult: 2.4, armorPen: 0.62,
    rpm: 600, recoil: { v: 0.030, h: 0.018 },
    spread: { hip: 0.05, ads: 0.008, move: 0.075 },
    range: 75, velocity: 715,
    magSize: 30, reserve: 90,
    reloadTime: 2.6, drawTime: 0.6,
    fireModes: ['auto', 'semi'],
    adsTime: 0.30, adsFovMult: 0.70,
    color: 0x553311, length: 0.88, barrelLen: 0.42,
    sound: 'rifle2', price: 2700, unlockXP: 500,
    desc: 'Hard-hitting 7.62mm rifle. High damage, heavier recoil.'
  },
  scar_h: {
    name: 'SCAR-H', class: 'ar', slot: 'primary',
    damage: 42, headMult: 2.3, armorPen: 0.7,
    rpm: 600, recoil: { v: 0.032, h: 0.014 },
    spread: { hip: 0.04, ads: 0.006, move: 0.06 },
    range: 90, velocity: 870,
    magSize: 20, reserve: 80,
    reloadTime: 2.8, drawTime: 0.55,
    fireModes: ['auto', 'semi'],
    adsTime: 0.32, adsFovMult: 0.65,
    color: 0x3a3a2a, length: 0.92, barrelLen: 0.45,
    sound: 'rifle1', price: 3500, unlockXP: 1500,
    desc: 'Battle rifle in 7.62 NATO. Devastating, but small mag.'
  },
  hk416: {
    name: 'HK416', class: 'ar', slot: 'primary',
    damage: 30, headMult: 2.5, armorPen: 0.58,
    rpm: 800, recoil: { v: 0.016, h: 0.010 },
    spread: { hip: 0.035, ads: 0.004, move: 0.055 },
    range: 85, velocity: 880,
    magSize: 30, reserve: 120,
    reloadTime: 2.0, drawTime: 0.45,
    fireModes: ['auto', 'burst', 'semi'],
    adsTime: 0.22, adsFovMult: 0.65,
    color: 0x2a2a2a, length: 0.84, barrelLen: 0.4,
    sound: 'rifle1', price: 3000, unlockXP: 1000,
    desc: 'Refined 5.56mm rifle. Higher RPM, very accurate.'
  },

  /* ========== SNIPERS ========== */
  m24: {
    name: 'M24 SWS', class: 'sniper', slot: 'primary',
    damage: 120, headMult: 3.0, armorPen: 0.85,
    rpm: 50, recoil: { v: 0.10, h: 0.02 },
    spread: { hip: 0.20, ads: 0.0005, move: 0.30 },
    range: 250, velocity: 850,
    magSize: 5, reserve: 25,
    reloadTime: 3.5, drawTime: 0.8,
    fireModes: ['semi'], boltAction: true,
    adsTime: 0.45, adsFovMult: 0.16, scoped: true, scopeZoom: 6,
    color: 0x1f1a14, length: 1.15, barrelLen: 0.6,
    sound: 'sniper1', price: 4500, unlockXP: 2000,
    desc: 'Bolt-action 7.62 sniper rifle. One-shot to upper body.'
  },
  awp: {
    name: '.338 LAPUA AWM', class: 'sniper', slot: 'primary',
    damage: 180, headMult: 3.0, armorPen: 0.95,
    rpm: 40, recoil: { v: 0.14, h: 0.03 },
    spread: { hip: 0.25, ads: 0.0002, move: 0.35 },
    range: 320, velocity: 936,
    magSize: 5, reserve: 20,
    reloadTime: 3.8, drawTime: 0.9,
    fireModes: ['semi'], boltAction: true,
    adsTime: 0.5, adsFovMult: 0.10, scoped: true, scopeZoom: 10,
    color: 0x3a3a44, length: 1.20, barrelLen: 0.65,
    sound: 'sniper2', price: 6500, unlockXP: 4500,
    desc: 'Heavy .338 magnum anti-personnel rifle. One-shot kill anywhere.'
  },
  mk14: {
    name: 'MK14 EBR', class: 'sniper', slot: 'primary',
    damage: 65, headMult: 2.5, armorPen: 0.75,
    rpm: 200, recoil: { v: 0.050, h: 0.020 },
    spread: { hip: 0.06, ads: 0.002, move: 0.10 },
    range: 150, velocity: 850,
    magSize: 20, reserve: 60,
    reloadTime: 2.5, drawTime: 0.7,
    fireModes: ['semi'],
    adsTime: 0.35, adsFovMult: 0.30, scoped: true, scopeZoom: 4,
    color: 0x222018, length: 1.0, barrelLen: 0.48,
    sound: 'rifle3', price: 4000, unlockXP: 2500,
    desc: 'Semi-auto designated marksman rifle in 7.62 NATO.'
  },

  /* ========== SMGs ========== */
  mp5: {
    name: 'MP5A3', class: 'smg', slot: 'primary',
    damage: 22, headMult: 2.0, armorPen: 0.35,
    rpm: 800, recoil: { v: 0.014, h: 0.008 },
    spread: { hip: 0.03, ads: 0.006, move: 0.04 },
    range: 40, velocity: 400,
    magSize: 30, reserve: 120,
    reloadTime: 2.0, drawTime: 0.4,
    fireModes: ['auto', 'burst', 'semi'],
    adsTime: 0.18, adsFovMult: 0.75,
    color: 0x1a1a1a, length: 0.65, barrelLen: 0.25,
    sound: 'smg1', price: 1500, unlockXP: 200,
    desc: '9mm SMG. Fast handling, great for CQB.'
  },
  p90: {
    name: 'P90', class: 'smg', slot: 'primary',
    damage: 20, headMult: 2.0, armorPen: 0.55,
    rpm: 900, recoil: { v: 0.013, h: 0.009 },
    spread: { hip: 0.035, ads: 0.007, move: 0.045 },
    range: 50, velocity: 715,
    magSize: 50, reserve: 150,
    reloadTime: 2.4, drawTime: 0.5,
    fireModes: ['auto'],
    adsTime: 0.22, adsFovMult: 0.75,
    color: 0x2a2a2a, length: 0.50, barrelLen: 0.26,
    sound: 'smg2', price: 2400, unlockXP: 800,
    desc: '5.7×28mm PDW. 50-rd mag with high armor penetration.'
  },

  /* ========== SHOTGUNS ========== */
  m870: {
    name: 'M870 PUMP', class: 'shotgun', slot: 'primary',
    damage: 24, pellets: 8, headMult: 1.5, armorPen: 0.4,
    rpm: 70, recoil: { v: 0.10, h: 0.04 },
    spread: { hip: 0.25, ads: 0.15, move: 0.30 },
    range: 18, velocity: 400,
    magSize: 7, reserve: 28,
    reloadTime: 0.5, reloadPerShell: true, drawTime: 0.7,
    fireModes: ['pump'],
    adsTime: 0.30, adsFovMult: 0.85,
    color: 0x2a1a0a, length: 0.95, barrelLen: 0.5,
    sound: 'shotgun1', price: 1800, unlockXP: 300,
    desc: '12-gauge pump shotgun. Lethal at close range.'
  },

  /* ========== PISTOLS (Secondary) ========== */
  m9: {
    name: 'M9 BERETTA', class: 'pistol', slot: 'secondary',
    damage: 26, headMult: 2.5, armorPen: 0.30,
    rpm: 450, recoil: { v: 0.020, h: 0.010 },
    spread: { hip: 0.05, ads: 0.012, move: 0.07 },
    range: 30, velocity: 380,
    magSize: 15, reserve: 60,
    reloadTime: 1.7, drawTime: 0.3,
    fireModes: ['semi'],
    adsTime: 0.18, adsFovMult: 0.80,
    color: 0x1a1a1a, length: 0.22, barrelLen: 0.12,
    sound: 'pistol1', price: 0, unlockXP: 0,
    desc: 'Standard issue 9mm pistol.'
  },
  glock18: {
    name: 'GLOCK 18C', class: 'pistol', slot: 'secondary',
    damage: 20, headMult: 2.3, armorPen: 0.25,
    rpm: 1100, recoil: { v: 0.022, h: 0.015 },
    spread: { hip: 0.06, ads: 0.018, move: 0.08 },
    range: 25, velocity: 360,
    magSize: 17, reserve: 68,
    reloadTime: 1.5, drawTime: 0.25,
    fireModes: ['auto', 'semi'],
    adsTime: 0.18, adsFovMult: 0.80,
    color: 0x1a1a1a, length: 0.20, barrelLen: 0.11,
    sound: 'pistol2', price: 800, unlockXP: 400,
    desc: 'Full-auto Glock 18. High RPM machine pistol.'
  },
  deagle: {
    name: 'DESERT EAGLE', class: 'pistol', slot: 'secondary',
    damage: 70, headMult: 2.8, armorPen: 0.65,
    rpm: 250, recoil: { v: 0.080, h: 0.030 },
    spread: { hip: 0.07, ads: 0.010, move: 0.10 },
    range: 45, velocity: 470,
    magSize: 7, reserve: 28,
    reloadTime: 2.0, drawTime: 0.4,
    fireModes: ['semi'],
    adsTime: 0.25, adsFovMult: 0.75,
    color: 0x6a5a2a, length: 0.27, barrelLen: 0.16,
    sound: 'pistol3', price: 2000, unlockXP: 1200,
    desc: '.50 AE hand cannon. Massive damage, slow follow-up.'
  },
};

/* ========== LETHAL & TACTICAL EQUIPMENT ========== */
const EQUIPMENT = {
  frag: {
    name: 'M67 FRAG', type: 'lethal',
    damage: 130, radius: 6, fuseTime: 3.5, throwForce: 18,
    desc: 'Fragmentation grenade. 4.5-sec fuse, 6m kill radius.',
    color: 0x224422, price: 0
  },
  semtex: {
    name: 'SEMTEX', type: 'lethal',
    damage: 150, radius: 5, fuseTime: 2.5, throwForce: 16, sticky: true,
    desc: 'Sticky plastic explosive. Adheres to surfaces.',
    color: 0x884422, price: 400, unlockXP: 600
  },
  flash: {
    name: 'FLASHBANG', type: 'tactical',
    blindDuration: 4, radius: 12, fuseTime: 1.8, throwForce: 18,
    desc: 'Stun grenade. Temporarily blinds & deafens targets.',
    color: 0xaaaa88, price: 0
  },
  smoke: {
    name: 'SMOKE', type: 'tactical',
    duration: 12, radius: 5, fuseTime: 1.5, throwForce: 16,
    desc: 'Smoke grenade. Provides 12s of cover.',
    color: 0x666666, price: 0, unlockXP: 100
  }
};

/* ========== ARMOR ========== */
const ARMOR = {
  none: { name: 'NO ARMOR', protection: 0, slowdown: 0, price: 0, hp: 0 },
  light: { name: 'LIGHT KEVLAR', protection: 0.3, slowdown: 0, price: 200, hp: 50, desc: 'Soft armor. Stops pistol rounds.' },
  medium: { name: 'PLATE CARRIER', protection: 0.55, slowdown: 0.08, price: 600, hp: 100, desc: 'Steel plates. Reduces rifle damage.', unlockXP: 300 },
  heavy: { name: 'HEAVY CERAMIC', protection: 0.75, slowdown: 0.18, price: 1200, hp: 150, desc: 'Lvl IV ceramic plates. Heavy but tough.', unlockXP: 1500 }
};

/* ========== CLASSES ========== */
const CLASSES = {
  assault: {
    name: 'ASSAULT', icon: '🎯',
    desc: 'Frontline soldier. Balanced loadout.',
    perk: 'Faster reload (+15%)',
    defaultLoadout: { primary: 'm4a1', secondary: 'm9', lethal: 'frag', tactical: 'flash', armor: 'medium' }
  },
  marksman: {
    name: 'MARKSMAN', icon: '🎯',
    desc: 'Long-range specialist with precision rifles.',
    perk: 'Hold breath while scoped (steady aim)',
    defaultLoadout: { primary: 'm24', secondary: 'm9', lethal: 'frag', tactical: 'smoke', armor: 'light' }
  },
  cqb: {
    name: 'BREACHER', icon: '⚡',
    desc: 'Close-quarters specialist. Shotguns & SMGs.',
    perk: 'Faster movement (+10%)',
    defaultLoadout: { primary: 'mp5', secondary: 'm9', lethal: 'frag', tactical: 'flash', armor: 'medium' }
  },
  heavy: {
    name: 'HEAVY GUNNER', icon: '🛡️',
    desc: 'Heavy armor and high-damage weapons.',
    perk: 'Extra armor capacity (+25 HP)',
    defaultLoadout: { primary: 'ak47', secondary: 'deagle', lethal: 'semtex', tactical: 'smoke', armor: 'heavy' }
  }
};

/* ========== RANKS ========== */
const RANKS = [
  { name: 'PVT', full: 'Private',          minXP: 0 },
  { name: 'PFC', full: 'Private First Class', minXP: 250 },
  { name: 'CPL', full: 'Corporal',         minXP: 750 },
  { name: 'SGT', full: 'Sergeant',         minXP: 1500 },
  { name: 'SSG', full: 'Staff Sergeant',   minXP: 3000 },
  { name: 'SFC', full: 'Sergeant First Class', minXP: 5000 },
  { name: 'MSG', full: 'Master Sergeant',  minXP: 8000 },
  { name: 'WO1', full: 'Warrant Officer',  minXP: 12000 },
  { name: '2LT', full: 'Second Lieutenant', minXP: 17000 },
  { name: '1LT', full: 'First Lieutenant', minXP: 24000 },
  { name: 'CPT', full: 'Captain',          minXP: 33000 },
  { name: 'MAJ', full: 'Major',            minXP: 45000 },
  { name: 'COL', full: 'Colonel',          minXP: 65000 }
];

function rankForXP(xp) {
  let r = RANKS[0];
  for (const rank of RANKS) if (xp >= rank.minXP) r = rank;
  return r;
}

/* ========== MISSIONS ========== */
const MISSIONS = [
  {
    id: 'tdm_urban',
    name: 'URBAN ASSAULT',
    type: 'tdm',
    desc: 'Eliminate all hostiles in the urban combat zone.',
    map: 'urban',
    targetKills: 12,
    timeLimit: 600,
    reward: { xp: 400, money: 1000 }
  },
  {
    id: 'defense_compound',
    name: 'HOLD THE COMPOUND',
    type: 'defense',
    desc: 'Defend the FOB from incoming waves of insurgents.',
    map: 'desert',
    waves: 4,
    timeLimit: 480,
    reward: { xp: 600, money: 1500 }
  },
  {
    id: 'hvt_elimination',
    name: 'HVT ELIMINATION',
    type: 'assassination',
    desc: 'Locate and eliminate a high-value target. Stealth recommended.',
    map: 'forest',
    targetKills: 1,
    bonusKills: 8,
    timeLimit: 720,
    reward: { xp: 800, money: 2000 }
  },
  {
    id: 'patrol_woods',
    name: 'WOODLAND PATROL',
    type: 'patrol',
    desc: 'Patrol the woodland sector and engage hostile forces.',
    map: 'forest',
    targetKills: 10,
    timeLimit: 600,
    reward: { xp: 500, money: 1200 }
  },
  {
    id: 'extract_intel',
    name: 'EXTRACT INTEL',
    type: 'extraction',
    desc: 'Reach the data terminal, secure intel, and exfil.',
    map: 'urban',
    targetKills: 8,
    timeLimit: 540,
    reward: { xp: 700, money: 1800 }
  },
  {
    id: 'survival_endless',
    name: 'LAST STAND',
    type: 'survival',
    desc: 'Survive endless waves. How long can you last?',
    map: 'desert',
    waves: 999,
    reward: { xp: 100, money: 200, perWave: true }
  }
];

/* ========== SOLDIER NAMES ========== */
const FIRST_NAMES = [
  'John','Mike','Jake','Carlos','Dimitri','Hassan','Sven','Yuri','Liam','Marcus',
  'Tyler','Connor','Ethan','Reese','Wyatt','Owen','Logan','Jackson','Cole','Brody',
  'Axel','Kai','Hudson','Zane','Ryker','Sergei','Diego','Tomas','Andre','Kenji'
];
const LAST_NAMES = [
  'Doe','Smith','Volkov','Rodriguez','Johnson','Williams','Brown','Martinez','Hayes','Reaper',
  'Cross','Stone','Knight','Hunter','Wolfe','Hawk','Black','Steel','Storm','Wilder',
  'Marsh','Reed','Vance','Sharp','Burke','Ortiz','Khan','Park','Tanaka','Mueller'
];

const ENEMY_FIRST = ['Viktor','Dmitri','Hakim','Boris','Klaus','Rashid','Yuri','Pavel','Omar','Ivan','Sergei','Aleksandr','Mikhail','Anatoly'];
const ENEMY_LAST = ['Volkov','Petrov','Sokolov','Kuznetsov','Orlov','Smirnov','Romanov','Kozlov','Novak','Tariq','Mahmoud','Karim'];

function randomSoldierName(faction = 'friendly') {
  if (faction === 'enemy') {
    return `${ENEMY_FIRST[Math.floor(Math.random()*ENEMY_FIRST.length)]} ${ENEMY_LAST[Math.floor(Math.random()*ENEMY_LAST.length)]}`;
  }
  return `${FIRST_NAMES[Math.floor(Math.random()*FIRST_NAMES.length)]} ${LAST_NAMES[Math.floor(Math.random()*LAST_NAMES.length)]}`;
}
