/* ============================================================
   BUBU A BUBUDUDU — TAG MODE (tag.js)
   2-player pakdam-pakai on one keyboard (Arrows vs WASD),
   or solo vs CPU. 60s round, tag = swap + 150, runner +10/s,
   pickups: bamboo +100 · coffee = speed · honey = slow foe.
   Reuses Engine + Sprites from the runner game.
   ============================================================ */
(function () {
  'use strict';

  let E, P, AU, IN, clamp, lerp, rand, randInt, choice, hash, TAU;

  const W = 960, H = 540;
  const ROUND = 60;
  const R = 26;                       // player radius
  const WALL = { l: 30, r: W - 30, t: 78, b: H - 26 };
  const OBST = [
    { x: 320, y: 205, r: 44 }, { x: 640, y: 205, r: 44 },
    { x: 320, y: 375, r: 44 }, { x: 640, y: 375, r: 44 },
  ];

  const $ = (id) => document.getElementById(id);
  const screens = {};
  let state = 'menu';                 // menu | countdown | play | paused | over
  let mode = '2p';                    // '2p' | 'cpu'
  let timer = ROUND, count = 0, ambient = 0, pickupT = 3;
  let players = [], pickups = [], flowers = [];
  let touchTarget = null;
  let hud = { b: -1, d: -1, t: -1, itB: null, itD: null };

  function mkPlayer(id) {
    const keys = id === 'bubu'
      ? { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'] }
      : { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'] };
    return {
      id, keys,
      x: id === 'bubu' ? 180 : W - 180,
      y: id === 'bubu' ? H - 130 : 130,
      vx: 0, vy: 0, r: R,
      score: 0, isIt: id === 'dudu',
      grace: 0, boost: 0, slow: 0,
      face: id === 'bubu' ? 1 : -1, walk: 0, ai: false,
    };
  }

  function setState(s) {
    state = s;
    Object.values(screens).forEach((el) => el.classList.remove('active'));
    if (screens[s]) screens[s].classList.add('active');
    if (s === 'play' || s === 'countdown') AU.startMusic(); else AU.stopMusic();
  }

  function resetRound() {
    players = [mkPlayer('bubu'), mkPlayer('dudu')];
    if (mode === 'cpu') players[1].ai = true;
    pickups = [];
    pickupT = 2.5;
    timer = ROUND;
    count = 3.4;
    P.clear();
    hud = { b: -1, d: -1, t: -1, itB: null, itD: null };
    updateHUD(true);
    setState('countdown');
  }

  /* ---------------- input vectors ---------------- */
  function keyVec(p) {
    let x = 0, y = 0;
    const k = IN.keys;
    for (const c of p.keys.up) if (k[c]) y -= 1;
    for (const c of p.keys.down) if (k[c]) y += 1;
    for (const c of p.keys.left) if (k[c]) x -= 1;
    for (const c of p.keys.right) if (k[c]) x += 1;
    const m = Math.hypot(x, y);
    return m ? { x: x / m, y: y / m } : null;
  }

  function aiVec(me, foe) {
    let x, y;
    if (me.isIt) {
      const tx = foe.x + foe.vx * 0.25, ty = foe.y + foe.vy * 0.25;
      x = tx - me.x; y = ty - me.y;
    } else {
      x = me.x - foe.x; y = me.y - foe.y;
      const m = Math.hypot(x, y) || 1; x /= m; y /= m;
      if (me.x < WALL.l + 90) x += 0.9;
      if (me.x > WALL.r - 90) x -= 0.9;
      if (me.y < WALL.t + 80) y += 0.9;
      if (me.y > WALL.b - 80) y -= 0.9;
      for (const ob of OBST) {
        const d = Math.hypot(me.x - ob.x, me.y - ob.y);
        if (d < ob.r + 95) { x += ((me.x - ob.x) / d) * 1.0; y += ((me.y - ob.y) / d) * 1.0; }
      }
      let best = null, bd = 300;
      for (const pk of pickups) {
        const dm = Math.hypot(pk.x - me.x, pk.y - me.y);
        const df = Math.hypot(pk.x - foe.x, pk.y - foe.y);
        if (dm < bd && df > dm + 30) { bd = dm; best = pk; }
      }
      if (best) {
        const dx = (best.x - me.x) / bd, dy = (best.y - me.y) / bd;
        x = x * 0.35 + dx * 0.85; y = y * 0.35 + dy * 0.85;
      }
      const j = Math.sin(ambient * 2.7) * 0.3;
      x += -y * j; y += x * j;
    }
    const m = Math.hypot(x, y);
    return m ? { x: x / m, y: y / m } : null;
  }

  function inputVec(p, foe) {
    if (p.ai) return aiVec(p, foe);
    if (p.id === 'bubu' && touchTarget) {
      const x = touchTarget.x - p.x, y = touchTarget.y - p.y;
      const m = Math.hypot(x, y);
      if (m < 8) return null;
      return { x: x / m, y: y / m };
    }
    return keyVec(p);
  }

  /* ---------------- update ---------------- */
  function updatePlayer(p, foe, dt) {
    p.grace = Math.max(0, p.grace - dt);
    p.boost = Math.max(0, p.boost - dt);
    p.slow = Math.max(0, p.slow - dt);

    const v = inputVec(p, foe);
    const max = 300 * (p.boost ? 1.42 : 1) * (p.slow ? 0.55 : 1);
    const tx = v ? v.x * max : 0, ty = v ? v.y * max : 0;
    const s = 1 - Math.pow(0.0006, dt);
    p.vx = lerp(p.vx, tx, s);
    p.vy = lerp(p.vy, ty, s);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (Math.abs(p.vx) > 20) p.face = p.vx > 0 ? 1 : -1;
    p.walk += Math.hypot(p.vx, p.vy) * dt * 0.05;

    // walls
    p.x = clamp(p.x, WALL.l + p.r, WALL.r - p.r);
    p.y = clamp(p.y, WALL.t + p.r, WALL.b - p.r);
    // bushes
    for (const ob of OBST) {
      const dx = p.x - ob.x, dy = p.y - ob.y;
      const d = Math.hypot(dx, dy), min = ob.r + p.r - 6;
      if (d < min && d > 0.001) {
        p.x = ob.x + (dx / d) * min;
        p.y = ob.y + (dy / d) * min;
      }
    }
    // boost trail
    if (p.boost && Math.random() < 0.5)
      P.spawn({ x: p.x - p.face * 14, y: p.y + 16, vx: -p.face * 40, vy: -20,
        life: 0.35, size: 5, color: 'rgba(255,209,102,0.8)' });
  }

  function update(dt) {
    ambient += dt;
    if (state === 'countdown') {
      const before = Math.ceil(count);
      count -= dt;
      const after = Math.ceil(count);
      if (after !== before && after > 0) AU.tone({ freq: 660, dur: 0.1, type: 'square', vol: 0.25 });
      if (count <= 0) { AU.tone({ freq: 990, dur: 0.25, type: 'square', vol: 0.3 }); setState('play'); }
      P.update(dt);
      return;
    }
    if (state !== 'play') { P.update(dt); return; }

    timer -= dt;
    if (timer <= 0) { timer = 0; endRound(); return; }

    const [B, D] = players;
    updatePlayer(B, D, dt);
    updatePlayer(D, B, dt);

    // runner survival points
    const runner = B.isIt ? D : B;
    runner.score += 10 * dt;

    // tag!
    if (B.grace <= 0 && D.grace <= 0) {
      const dx = D.x - B.x, dy = D.y - B.y;
      const d = Math.hypot(dx, dy);
      if (d < B.r + D.r - 6) {
        const tagger = B.isIt ? B : D;
        const tagged = tagger === B ? D : B;
        tagger.score += 150;
        tagger.isIt = false;
        tagged.isIt = true;
        tagged.grace = 1.2;
        const nx = dx / (d || 1), ny = dy / (d || 1);
        B.vx -= nx * 240; B.vy -= ny * 240;
        D.vx += nx * 240; D.vy += ny * 240;
        P.hearts((B.x + D.x) / 2, (B.y + D.y) / 2, 14);
        P.text((B.x + D.x) / 2, (B.y + D.y) / 2 - 46, 'TAG! +150', '#ff8fab');
        AU.sfx.collect();
        AU.tone({ freq: 520, end: 880, dur: 0.14, type: 'square', vol: 0.25 });
      }
    }

    // pickups
    pickupT -= dt;
    if (pickupT <= 0 && pickups.length < 3) {
      pickupT = 3.5;
      spawnPickup();
    }
    for (let i = pickups.length - 1; i >= 0; i--) {
      const pk = pickups[i];
      pk.life -= dt;
      pk.ph += dt * 3;
      if (pk.life <= 0) { pickups.splice(i, 1); continue; }
      for (const p of players) {
        if (Math.hypot(p.x - pk.x, p.y - pk.y) < p.r + 18) {
          applyPickup(p, pk);
          pickups.splice(i, 1);
          break;
        }
      }
    }

    P.update(dt);
    updateHUD(false);
  }

  function spawnPickup() {
    const r = Math.random();
    const type = r < 0.5 ? 'bamboo' : r < 0.75 ? 'coffee' : 'honey';
    for (let tries = 0; tries < 14; tries++) {
      const x = rand(80, W - 80), y = rand(110, H - 60);
      let ok = true;
      for (const ob of OBST) if (Math.hypot(x - ob.x, y - ob.y) < ob.r + 46) ok = false;
      for (const p of players) if (Math.hypot(x - p.x, y - p.y) < 130) ok = false;
      if (ok) { pickups.push({ x, y, type, life: 9, ph: rand(0, TAU) }); return; }
    }
  }

  function applyPickup(p, pk) {
    const foe = players.find((q) => q !== p);
    if (pk.type === 'bamboo') {
      p.score += 100;
      P.sparkle(pk.x, pk.y, '#b8ec62', 10);
      P.text(pk.x, pk.y - 30, '+100');
      AU.sfx.collect();
    } else if (pk.type === 'coffee') {
      p.boost = 3;
      P.sparkle(pk.x, pk.y, '#ffd166', 10);
      P.text(pk.x, pk.y - 30, 'ZOOM!');
      AU.sfx.jump();
    } else {
      foe.slow = 2.5;
      P.sparkle(pk.x, pk.y, '#c98a1b', 10);
      P.text(foe.x, foe.y - 46, 'SLOW! 🍯', '#c98a1b');
      AU.sfx.land();
    }
  }

  function endRound() {
    const [B, D] = players;
    const sb = Math.floor(B.score), sd = Math.floor(D.score);
    $('finalB').textContent = sb;
    $('finalD').textContent = sd;
    const img = $('winnerImg'), txt = $('winnerText'), quip = $('overQuip');
    if (sb > sd) {
      txt.textContent = 'BUBU WINS! 🎉';
      img.src = Sprites.url('bubu');
      quip.textContent = 'Bubu outran love itself… barely! 💨';
    } else if (sd > sb) {
      txt.textContent = 'DUDU WINS! 🎉';
      img.src = Sprites.url('dudu');
      quip.textContent = 'Dudu\'s hugs are unstoppable! 💞';
    } else {
      txt.textContent = "IT'S A TIE! 💞";
      img.src = Sprites.url('bubu');
      quip.textContent = 'A tie? True love always balances out! 💞';
    }
    AU.sfx.level();
    setState('over');
  }

  function updateHUD(force) {
    const [B, D] = players;
    if (!B) return;
    const sb = Math.floor(B.score), sd = Math.floor(D.score), t = Math.ceil(timer);
    if (force || sb !== hud.b) { $('tagScoreB').textContent = sb; hud.b = sb; }
    if (force || sd !== hud.d) { $('tagScoreD').textContent = sd; hud.d = sd; }
    if (force || t !== hud.t) {
      $('tagTimer').textContent = t;
      $('tagTimer').classList.toggle('hurry', t <= 10 && state === 'play');
      hud.t = t;
    }
    if (force || B.isIt !== hud.itB) { $('itB').classList.toggle('on', B.isIt); hud.itB = B.isIt; }
    if (force || D.isIt !== hud.itD) { $('itD').classList.toggle('on', D.isIt); hud.itD = D.isIt; }
  }

  /* ---------------- render ---------------- */
  function render() {
    E.Canvas.use('tagCanvas');
    const ctx = E.Canvas.ctx;
    E.Canvas.begin();

    // grass field
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#8ed473');
    g.addColorStop(1, '#68b052');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let x = 0; x < W; x += 160) ctx.fillRect(x, 0, 80, H);
    for (const f of flowers) {
      ctx.fillStyle = f.c;
      ctx.beginPath(); ctx.arc(f.x, f.y, 3.4, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.arc(f.x - 1, f.y - 1, 1.2, 0, TAU); ctx.fill();
    }
    // fence border
    ctx.strokeStyle = '#7a4a2b';
    ctx.lineWidth = 12;
    ctx.strokeRect(8, 8, W - 16, H - 16);
    ctx.strokeStyle = '#9c6b3f';
    ctx.lineWidth = 4;
    ctx.strokeRect(14, 14, W - 28, H - 28);
    ctx.fillStyle = '#5da344';
    for (let x = 24; x < W - 16; x += 48) {
      ctx.beginPath(); ctx.arc(x, 20, 7, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 24, H - 20, 7, 0, TAU); ctx.fill();
    }

    // depth-sorted world
    const items = [];
    for (const ob of OBST) items.push({ y: ob.y + ob.r * 0.4, draw: () => drawBush(ctx, ob) });
    for (const pk of pickups) items.push({ y: pk.y, draw: () => drawPickup(ctx, pk) });
    for (const p of players) items.push({ y: p.y + p.r, draw: () => drawPlayer(ctx, p) });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();

    P.render(ctx);

    if (state === 'countdown') {
      const n = Math.ceil(count);
      ctx.save();
      ctx.translate(W / 2, H / 2 - 20);
      const pop = 1 + (count % 1) * 0.25;
      ctx.scale(pop, pop);
      ctx.font = "64px 'Press Start 2P', monospace";
      ctx.textAlign = 'center';
      ctx.lineWidth = 10;
      ctx.strokeStyle = 'rgba(45,80,22,0.9)';
      const label = n > 3 ? '' : n > 0 ? String(n) : 'GO!';
      ctx.strokeText(label, 0, 0);
      ctx.fillStyle = '#ffd166';
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }

    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(20,40,25,0.3)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  function drawBush(ctx, ob) {
    ctx.fillStyle = 'rgba(30,60,30,0.25)';
    ctx.beginPath(); ctx.ellipse(ob.x, ob.y + ob.r * 0.55, ob.r * 1.05, ob.r * 0.4, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#3e8948';
    ctx.beginPath();
    ctx.arc(ob.x - ob.r * 0.45, ob.y, ob.r * 0.62, 0, TAU);
    ctx.arc(ob.x + ob.r * 0.45, ob.y - 2, ob.r * 0.6, 0, TAU);
    ctx.arc(ob.x, ob.y - ob.r * 0.42, ob.r * 0.66, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#57a860';
    ctx.beginPath();
    ctx.arc(ob.x - ob.r * 0.2, ob.y - ob.r * 0.35, ob.r * 0.4, 0, TAU);
    ctx.arc(ob.x + ob.r * 0.3, ob.y - ob.r * 0.1, ob.r * 0.34, 0, TAU);
    ctx.fill();
    // bamboo sticks poking out
    ctx.strokeStyle = '#6abe30';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(ob.x - 8, ob.y - ob.r * 0.6);
    ctx.lineTo(ob.x - 14, ob.y - ob.r - 16);
    ctx.moveTo(ob.x + 10, ob.y - ob.r * 0.55);
    ctx.lineTo(ob.x + 16, ob.y - ob.r - 10);
    ctx.stroke();
  }

  function drawPickup(ctx, pk) {
    const bob = Math.sin(pk.ph) * 4;
    const blink = pk.life < 2 ? (Math.sin(pk.life * 18) > 0 ? 1 : 0.35) : 1;
    ctx.save();
    ctx.globalAlpha = blink;
    ctx.fillStyle = 'rgba(30,60,30,0.25)';
    ctx.beginPath(); ctx.ellipse(pk.x, pk.y + 14, 16, 6, 0, 0, TAU); ctx.fill();
    ctx.translate(pk.x, pk.y + bob);
    if (pk.type === 'bamboo') {
      const sg = ctx.createLinearGradient(-7, 0, 7, 0);
      sg.addColorStop(0, '#4d9427'); sg.addColorStop(0.4, '#b8ec62'); sg.addColorStop(1, '#4d9427');
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.moveTo(-7 + 7, -26);
      ctx.arcTo(7, -26, 7, 26, 6);
      ctx.arcTo(7, 26, -7, 26, 6);
      ctx.arcTo(-7, 26, -7, -26, 6);
      ctx.arcTo(-7, -26, 7, -26, 6);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#2d5016'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-7, -8); ctx.lineTo(7, -8);
      ctx.moveTo(-7, 8); ctx.lineTo(7, 8);
      ctx.stroke();
      ctx.fillStyle = '#6abe30';
      ctx.beginPath(); ctx.ellipse(-11, -24, 9, 4, -0.6, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(11, -20, 9, 4, 0.6, 0, TAU); ctx.fill();
    } else {
      ctx.font = '30px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(pk.type === 'coffee' ? '☕' : '🍯', 0, 0);
    }
    ctx.restore();
  }

  function drawPlayer(ctx, p) {
    const moving = Math.hypot(p.vx, p.vy) > 30;
    // shadow
    ctx.fillStyle = 'rgba(30,60,30,0.3)';
    ctx.beginPath(); ctx.ellipse(p.x, p.y + p.r * 0.85, p.r * 0.95, p.r * 0.34, 0, 0, TAU); ctx.fill();
    // IT aura ring
    if (p.isIt) {
      const pul = 1 + Math.sin(ambient * 6) * 0.12;
      ctx.strokeStyle = 'rgba(255,143,171,0.85)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + p.r * 0.85, p.r * 1.15 * pul, p.r * 0.42 * pul, 0, 0, TAU);
      ctx.stroke();
    }
    if (p.slow) {
      ctx.fillStyle = 'rgba(120,160,255,0.28)';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 1.35, 0, TAU); ctx.fill();
    }
    ctx.save();
    if (p.grace > 0 && Math.floor(ambient * 14) % 2 === 0) ctx.globalAlpha = 0.4;
    ctx.translate(p.x, p.y + p.r * 0.8);
    const bob = moving ? Math.sin(p.walk * 6) * 2.5 : Math.sin(ambient * 2.4) * 1.5;
    const lean = clamp(p.vx * 0.0004, -0.14, 0.14);
    ctx.rotate(lean);
    ctx.scale(p.face, 1);
    const dh = 76 + (moving ? Math.abs(Math.sin(p.walk * 6)) * 3 : 0);
    const dw = dh * 0.78;
    Sprites.draw(ctx, p.id, -dw / 2, -dh + bob * 0.4, dw, dh);
    ctx.restore();
    // IT bubble
    if (p.isIt) {
      const by = p.y - p.r - 34 + Math.sin(ambient * 5) * 3;
      ctx.save();
      ctx.fillStyle = '#ff8fab';
      ctx.strokeStyle = '#68203a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(p.x - 26, by - 14);
      ctx.arcTo(p.x + 26, by - 14, p.x + 26, by + 14, 10);
      ctx.arcTo(p.x + 26, by + 14, p.x - 26, by + 14, 10);
      ctx.arcTo(p.x - 26, by + 14, p.x - 26, by - 14, 10);
      ctx.arcTo(p.x - 26, by - 14, p.x + 26, by - 14, 10);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x - 6, by + 13); ctx.lineTo(p.x + 6, by + 13); ctx.lineTo(p.x, by + 22);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#68203a';
      ctx.font = "13px 'Press Start 2P', monospace";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('IT!', p.x, by + 1);
      ctx.restore();
    }
  }

  /* ---------------- boot ---------------- */
  function boot() {
    E = Engine; P = E.createParticles(); AU = E.Audio; IN = E.Input;
    clamp = E.clamp; lerp = E.lerp; rand = E.rand; randInt = E.randInt;
    choice = E.choice; hash = E.hash; TAU = E.TAU;

    screens.menu = $('tagMenuScreen');
    screens.paused = $('tagPauseScreen');
    screens.over = $('tagOverScreen');

    E.Canvas.init($('tagCanvas'));
    IN.init();
    flowers = [];
    for (let i = 0; i < 46; i++)
      flowers.push({
        x: rand(30, W - 30), y: rand(40, H - 30),
        c: choice(['#fff6e0', '#ffd166', '#ff8fab', '#fdfdfd']),
      });

    const click = (id, fn) => {
      const el = $(id);
      if (el) el.addEventListener('click', () => { el.blur(); AU.unlock(); AU.sfx.click(); fn(); });
    };
    click('btn2p', () => { mode = '2p'; resetRound(); });
    click('btnCpu', () => { mode = 'cpu'; resetRound(); });
    click('backRunnerBtn', () => {
      if (window.showPage) window.showPage('runner');
      else window.location.href = 'index.html';
    });
    click('tagResumeBtn', () => { if (state === 'paused') setState('play'); });
    click('tagQuitBtn', () => setState('menu'));
    click('tagRematchBtn', () => resetRound());
    click('tagMenuBtn', () => setState('menu'));
    click('tagPauseBtn', () => { if (state === 'play' || state === 'countdown') setState('paused'); });

    window.addEventListener('keydown', (e) => {
      if (window.PAGE && window.PAGE !== 'tag') return;   // single-file mode guard
      if (e.code === 'KeyP' || e.code === 'Escape') {
        if (state === 'play' || state === 'countdown') setState('paused');
        else if (state === 'paused') setState('play');
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (window.PAGE && window.PAGE !== 'tag') return;
      if (document.hidden && (state === 'play' || state === 'countdown')) setState('paused');
    });

    // touch / mouse steer (solo mode)
    const cv = $('tagCanvas');
    const toLogical = (cx, cy) => {
      const r = cv.getBoundingClientRect();
      return { x: ((cx - r.left) / r.width) * W, y: ((cy - r.top) / r.height) * H };
    };
    cv.addEventListener('touchstart', (e) => { AU.unlock(); touchTarget = toLogical(e.changedTouches[0].clientX, e.changedTouches[0].clientY); }, { passive: true });
    cv.addEventListener('touchmove', (e) => { touchTarget = toLogical(e.changedTouches[0].clientX, e.changedTouches[0].clientY); e.preventDefault(); }, { passive: false });
    cv.addEventListener('touchend', () => { touchTarget = null; });
    cv.addEventListener('mousedown', (e) => { if (mode === 'cpu') touchTarget = toLogical(e.clientX, e.clientY); });
    cv.addEventListener('mousemove', (e) => { if (touchTarget && mode === 'cpu') touchTarget = toLogical(e.clientX, e.clientY); });
    window.addEventListener('mouseup', () => { touchTarget = null; });

    Sprites.load((p) => { const bar = $('loadingProgress'); if (bar) bar.style.width = Math.round(p * 100) + '%'; })
      .then(() => new Promise((r) => setTimeout(r, 400)))
      .then(() => {
        $('loadingScreen').classList.add('hidden');
        E.Loop.start(update, render);
      });
  }

  window.addEventListener('DOMContentLoaded', boot);
  window.TagGame = { pause: () => { if (state === 'play' || state === 'countdown') setState('paused'); }, getState: () => state };
})();
