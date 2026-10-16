/* ============================================================
   BUBU A BUBUDUDU — game.js
   Endless runner: help Bubu sprint through the bamboo grove,
   snatch bamboo (+100), dodge Dudu. 3 lives, levels every 1200 pts.
   ============================================================ */
window.Game = (function () {
  'use strict';

  /* NOTE: this file is parsed BEFORE engine.js (markup script order),
     so Engine/Sprites are resolved lazily inside boot(). */
  let clamp, lerp, rand, randInt, choice, aabb, hash, TAU, P, AU, IN;

  /* ---------------- world constants ---------------- */
  const W = 960, H = 540;
  const GROUND = 468;
  const LEVEL_STEP = 1200;

  const PLAYER = {
    w: 54, h: 92, crouchH: 54,
    minX: 70, maxX: 430, startX: 190,
    runAccel: 1600, runSpeed: 270,
    gravity: 2350, jumpV: -845, jumpCut: -330,
    coyote: 0.09, buffer: 0.13,
  };

  /* ---------------- dom ---------------- */
  const $ = (id) => document.getElementById(id);
  const dom = {};
  const screens = {};

  /* ---------------- state ---------------- */
  let state = 'boot';           // boot | menu | playing | paused | levelcomplete | gameover
  let ambient = 0;              // always-running clock (clouds, sun, idle bob)
  let score = 0, lives = 3, level = 1;
  let distance = 0, speed = 0, levelTime = 0;
  let spawnT = 1.2, readyT = 0, banner = '';
  let invuln = 0, flash = 0, shake = 0;
  let firstWallDone = false;
  let highScore = 0;
  let hazards = [], bamboos = [], deco = [], clouds = [], walls = [];
  let hudCache = { s: -1, l: -1, v: -1 };

  const player = {
    x: PLAYER.startX, y: GROUND - PLAYER.h, vx: 0, vy: 0,
    onGround: true, crouching: false, coyote: 0, buffer: 0,
    runPhase: 0, squash: 0, facing: 1,
    wall: null,        // { w, mode:'cling'|'scoop' }
    wallRide: null,    // wall object whose top we're running on
  };

  /* ---------------- helpers ---------------- */
  function setState(s) {
    state = s;
    Object.values(screens).forEach((el) => el.classList.remove('active'));
    if (screens[s]) screens[s].classList.add('active');
    if (s === 'playing') AU.startMusic(); else AU.stopMusic();
  }

  function updateHUD(force) {
    const s = Math.floor(score);
    if (force || s !== hudCache.s) { dom.score.textContent = s; hudCache.s = s; }
    if (force || lives !== hudCache.l) { dom.lives.textContent = lives; hudCache.l = lives; }
    if (force || level !== hudCache.v) { dom.level.textContent = level; hudCache.v = level; }
  }

  function initClouds() {
    clouds = [];
    for (let i = 0; i < 5; i++)
      clouds.push({ x: rand(0, W), y: rand(40, 190), s: rand(0.6, 1.3), v: rand(6, 16) });
  }

  function resetWorld(full) {
    if (full) { score = 0; lives = 3; level = 1; }
    distance = 0; levelTime = 0; spawnT = 1.1;
    firstWallDone = false;
    hazards = []; bamboos = []; deco = []; walls = [];
    P.clear();
    player.x = PLAYER.startX; player.y = GROUND - PLAYER.h;
    player.vx = 0; player.vy = 0; player.onGround = true;
    player.crouching = false; player.squash = 0;
    player.wall = null; player.wallRide = null;
    invuln = full ? 0 : 1.2; flash = 0; shake = 0;
    readyT = full ? 1.5 : 1.2;
    banner = full ? 'GET READY!' : 'LEVEL ' + level;
    speed = 0;
    for (let i = 0; i < 8; i++)
      deco.push(makeDeco(rand(0, W)));
    updateHUD(true);
  }

  function makeDeco(x) {
    return { x, kind: randInt(0, 2), s: rand(0.7, 1.25) };
  }

  /* ---------------- spawning ---------------- */
  function spawnPattern() {
    const r = Math.random();
    const lv = level;
    if (r < 0.26) {                                   // bamboo row (jump arc)
      const n = randInt(3, 5);
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0.5 : i / (n - 1);
        bamboos.push({
          x: W + 60 + i * 54,
          y: GROUND - 92 - Math.sin(t * Math.PI) * 52,
          ph: rand(0, TAU), taken: false,
        });
      }
    } else if (r < 0.40) {                            // high bamboo line
      const n = randInt(3, 4);
      for (let i = 0; i < n; i++)
        bamboos.push({ x: W + 60 + i * 58, y: GROUND - 168, ph: rand(0, TAU), taken: false });
    } else if (r < 0.58) {                            // ground Dudu(s)
      const n = 1 + (lv > 2 && Math.random() < 0.45 ? 1 : 0);
      for (let i = 0; i < n; i++)
        hazards.push({
          type: 'run', x: W + 90 + i * 170, y: GROUND - 96,
          w: 62, h: 96, extra: rand(25, 60) + lv * 7, ph: rand(0, TAU),
        });
    } else if (r < 0.72) {                            // hopping Dudu
      hazards.push({
        type: 'hop', x: W + 90, y: GROUND - 96, baseY: GROUND - 96,
        w: 62, h: 96, extra: rand(0, 20), hopH: rand(95, 135),
        rate: rand(2.3, 3.1), ph: rand(0, 1),
      });
    } else if (r < 0.86) {                            // BAMBOO WALL — ride it!
      const h = randInt(150, 195);
      const wl = { x: W + 90, w: 64, h, top: GROUND - h };
      walls.push(wl);
      const n = randInt(2, 3);
      for (let i = 0; i < n; i++)
        bamboos.push({ x: wl.x + 2 + i * 22, y: wl.top - 66, ph: rand(0, TAU), taken: false });
      spawnT += 0.8;                                  // breathing room after a wall
    } else {                                          // combo: Dudu + bait bamboo
      hazards.push({
        type: 'run', x: W + 140, y: GROUND - 96,
        w: 62, h: 96, extra: rand(20, 45) + lv * 5, ph: rand(0, TAU),
      });
      for (let i = 0; i < 4; i++) {
        const t = i / 3;
        bamboos.push({
          x: W + 90 + i * 56,
          y: GROUND - 150 - Math.sin(t * Math.PI) * 34,
          ph: rand(0, TAU), taken: false,
        });
      }
    }
  }

  /* ---------------- player physics ---------------- */
  function updatePlayer(dt) {
    const dir = (IN.down('right') ? 1 : 0) - (IN.down('left') ? 1 : 0);
    if (dir) player.facing = dir;
    const target = dir * PLAYER.runSpeed;
    const acc = PLAYER.runAccel * (player.onGround ? 1 : 0.55);
    player.vx = clamp(player.vx + clamp(target - player.vx, -acc * dt, acc * dt),
      -PLAYER.runSpeed, PLAYER.runSpeed);
    player.x = clamp(player.x + player.vx * dt, PLAYER.minX, PLAYER.maxX);

    // crouch
    const wantCrouch = IN.down('crouch');
    if (wantCrouch && player.onGround) {
      if (!player.crouching) { player.crouching = true; player.y += PLAYER.h - PLAYER.crouchH; }
    } else if (player.crouching) {
      player.crouching = false; player.y -= PLAYER.h - PLAYER.crouchH;
    }
    if (wantCrouch && !player.onGround) player.vy += 2600 * dt;   // fast-fall

    // jump buffering + coyote time
    if (IN.hit('jump')) player.buffer = PLAYER.buffer;
    player.buffer -= dt; player.coyote -= dt;
    if (player.buffer > 0 && player.coyote > 0) {
      player.vy = PLAYER.jumpV;
      player.onGround = false;
      player.coyote = 0; player.buffer = 0;
      player.squash = -0.22;
      player.wall = null; player.wallRide = null;
      P.dust(player.x + PLAYER.w / 2, GROUND, 6);
      AU.sfx.jump();
    }
    // variable jump height
    if (!IN.down('jump') && player.vy < PLAYER.jumpCut) player.vy = PLAYER.jumpCut;

    if (player.wall) {
      /* vertical movement handled by wallInteract */
    } else if (!player.onGround) {
      player.vy += PLAYER.gravity * dt;
      const ph = player.crouching ? PLAYER.crouchH : PLAYER.h;
      const prevFeet = player.y + ph;
      player.y += player.vy * dt;
      const feet = player.y + ph;
      let landed = false;
      if (player.vy >= 0) {
        for (const w of walls) {                      // land on a wall top
          if (player.x + PLAYER.w > w.x + 4 && player.x < w.x + w.w - 4 &&
              prevFeet <= w.top + 6 && feet >= w.top) {
            player.y = w.top - ph; player.vy = 0; player.onGround = true;
            player.wallRide = w; player.squash = 0.26; landed = true;
            P.dust(player.x + PLAYER.w / 2, w.top, 8);
            AU.sfx.land();
            break;
          }
        }
      }
      if (!landed) {
        const floor = (player.wallRide ? player.wallRide.top : GROUND) - ph;
        if (player.y >= floor) {
          player.y = floor; player.vy = 0; player.onGround = true;
          player.squash = 0.26;
          P.dust(player.x + PLAYER.w / 2, player.wallRide ? player.wallRide.top : GROUND, 8);
          AU.sfx.land();
        }
      }
    } else {
      player.coyote = PLAYER.coyote;
      player.runPhase += dt * (6 + speed * 0.02);
    }
    player.squash = lerp(player.squash, 0, 1 - Math.pow(0.0018, dt));
  }

  /* ---------- WALL RIDE: cling, climb, scoop, ride the top ---------- */
  function mountWall(w) {
    const ph = player.crouching ? PLAYER.crouchH : PLAYER.h;
    player.wall = null;
    player.wallRide = w;
    player.onGround = true;
    player.vy = 0;
    player.y = w.top - ph;
    player.squash = -0.15;
    player.x = clamp(w.x - 20, PLAYER.minX, PLAYER.maxX);  // hop onto the top smoothly
    P.dust(player.x + PLAYER.w / 2, w.top, 6);
    AU.sfx.land();
  }

  function wallInteract(dt) {
    const ph = player.crouching ? PLAYER.crouchH : PLAYER.h;
    for (let i = walls.length - 1; i >= 0; i--) {
      walls[i].x -= speed * dt;
      if (walls[i].x < -walls[i].w - 60) walls.splice(i, 1);
    }
    if (player.wallRide) {
      const w = player.wallRide;
      const over = player.x + PLAYER.w > w.x + 2 && player.x < w.x + w.w - 2;
      if (!over || walls.indexOf(w) === -1) { player.wallRide = null; player.onGround = false; }
    }
    if (player.wall) {
      const w = player.wall.w;
      if (walls.indexOf(w) === -1 || player.x + PLAYER.w < w.x - 8) player.wall = null;
      else if (player.wall.mode === 'scoop') {
        player.vy = 0;
        player.y -= 430 * dt;                          // wheee — free lift!
        player.x = w.x - PLAYER.w + 2;
        if (Math.random() < 0.5) P.dust(player.x + PLAYER.w - 4, player.y + ph, 1);
        if (player.y + ph <= w.top + 2) mountWall(w);
      } else {                                         // cling
        if (IN.hit('jump')) {                          // wall-jump away
          player.wall = null;
          player.vy = PLAYER.jumpV * 0.95;
          player.vx = -340;
          player.buffer = 0;
          player.x = clamp(player.x, PLAYER.minX, PLAYER.maxX);
          P.dust(player.x + PLAYER.w / 2, player.y + ph, 6);
          AU.sfx.jump();
        } else {
          const climb = IN.down('right') || IN.down('jump');
          player.vy = climb ? -250 : Math.min(player.vy + 900 * dt, 95);
          player.y += player.vy * dt;
          player.x = Math.min(player.x, w.x - PLAYER.w + 2);
          if (climb && Math.random() < 0.5) P.dust(player.x + PLAYER.w - 6, player.y + ph - 6, 1);
          if (player.y + ph <= w.top + 4) mountWall(w);
          else if (player.y + ph >= GROUND - 2) {
            player.y = GROUND - ph; player.vy = 0;
            player.wall = null; player.onGround = true;
            player.x = clamp(player.x, PLAYER.minX, PLAYER.maxX);
          }
        }
      }
      return;
    }
    for (const w of walls) {
      const horiz = player.x + PLAYER.w > w.x && player.x < w.x + w.w;
      if (!horiz) continue;
      const feet = player.y + ph;
      if (feet <= w.top + 6) continue;                 // above the top — landing handles it
      if (!player.onGround && player.x + PLAYER.w < w.x + 30 && player.vy >= -60) {
        player.wall = { w, mode: 'cling' };            // grab the face mid-air
        player.vx = 0;
        AU.tone({ freq: 240, end: 320, dur: 0.08, type: 'triangle', vol: 0.2 });
      } else if (player.onGround) {
        player.wall = { w, mode: 'scoop' };            // wall scoops you up for a ride
        player.onGround = false;
        AU.tone({ freq: 330, end: 660, dur: 0.18, type: 'triangle', vol: 0.22 });
        P.sparkle(player.x + PLAYER.w / 2, player.y + ph - 20, '#b8ec62', 6);
      } else {
        player.x = w.x - PLAYER.w;                     // bonk — slide along the face
        player.vx = Math.min(player.vx, 0);
      }
      break;
    }
  }

  function playerBox() {
    const h = player.crouching ? PLAYER.crouchH : PLAYER.h;
    return { x: player.x + 9, y: player.y + 6, w: PLAYER.w - 18, h: h - 10 };
  }

  /* ---------------- world update ---------------- */
  function updateWorld(dt) {
    ambient += dt;
    if (readyT > 0) {
      readyT -= dt;
      updatePlayer(dt);
      P.update(dt);
      return;
    }

    levelTime += dt;
    speed = (330 + (level - 1) * 42) * (1 + Math.min(0.22, levelTime * 0.006));
    distance += speed * dt;
    score += speed * dt * 0.02;

    // guarantee the first wall early so everyone meets the wall ride
    if (!firstWallDone && levelTime > 3.5) {
      firstWallDone = true;
      const h = randInt(150, 180);
      const wl = { x: W + 90, w: 64, h, top: GROUND - h };
      walls.push(wl);
      for (let i = 0; i < 3; i++)
        bamboos.push({ x: wl.x + 2 + i * 22, y: wl.top - 66, ph: rand(0, TAU), taken: false });
      P.text(W - 120, wl.top - 60, 'WALL RIDE!', '#b8ec62');
      spawnT += 1.0;
    }

    updatePlayer(dt);
    wallInteract(dt);
    spawnT -= dt;
    if (spawnT <= 0) {
      spawnPattern();
      spawnT = rand(0.85, 1.45) * clamp(360 / speed, 0.6, 1.15) - level * 0.015;
    }

    // hazards
    const pb = playerBox();
    for (let i = hazards.length - 1; i >= 0; i--) {
      const hz = hazards[i];
      hz.x -= (speed + hz.extra) * dt;
      hz.ph += dt * 9;
      if (hz.type === 'hop') {
        hz.ph2 = (hz.ph2 || 0) + dt * hz.rate;
        hz.squash = Math.abs(Math.sin(hz.ph2 * Math.PI));
        hz.y = hz.baseY - hz.squash * hz.hopH;
      }
      if (hz.x < -160) { hazards.splice(i, 1); continue; }
      if (invuln <= 0 && aabb(pb, { x: hz.x + 8, y: hz.y + 8, w: hz.w - 16, h: hz.h - 12 })) {
        hazards.splice(i, 1);
        onHit(hz);
      }
    }

    // bamboo
    for (let i = bamboos.length - 1; i >= 0; i--) {
      const b = bamboos[i];
      b.x -= speed * dt;
      b.ph += dt * 3;
      if (b.x < -60) { bamboos.splice(i, 1); continue; }
      const bb = { x: b.x - 14, y: b.y - 30 + Math.sin(b.ph) * 4, w: 28, h: 62 };
      if (aabb(pb, bb)) {
        bamboos.splice(i, 1);
        score += 100;
        P.sparkle(b.x, b.y, '#b8ec62', 12);
        P.text(b.x, b.y - 34, '+100');
        AU.sfx.collect();
      }
    }

    // scenery recycle
    for (const d of deco) {
      d.x -= speed * dt;
      if (d.x < -40) { d.x += W + 80; Object.assign(d, makeDeco(d.x)); }
    }
    for (const c of clouds) {
      c.x -= (c.v + speed * 0.02) * dt;
      if (c.x < -140) { c.x = W + rand(40, 160); c.y = rand(40, 190); }
    }

    P.update(dt);
    invuln = Math.max(0, invuln - dt);
    flash = Math.max(0, flash - dt);
    shake = Math.max(0, shake - dt * 1.6);

    // level up?
    if (score >= level * LEVEL_STEP) {
      dom.levelScore.textContent = Math.floor(score);
      AU.sfx.level();
      setState('levelcomplete');
      return;
    }
    updateHUD(false);
  }

  function onHit(hz) {
    lives--;
    invuln = 2;
    flash = 0.4;
    shake = 0.55;
    P.hearts(hz.x + hz.w / 2, hz.y + hz.h / 2, 12);
    P.poof(hz.x + hz.w / 2, hz.y + hz.h / 2, 8);
    P.text(player.x + PLAYER.w / 2, player.y - 14, 'HUGGED! -1♥', '#ff8fab');
    AU.sfx.hit();
    updateHUD(true);
    if (lives <= 0) gameOver();
  }

  function gameOver() {
    try {
      highScore = Math.max(highScore, Math.floor(score));
      localStorage.setItem('bubuHighScore', String(highScore));
    } catch (e) { /* private mode etc. */ }
    dom.finalScore.textContent = Math.floor(score);
    dom.highScore.textContent = highScore;
    AU.sfx.over();
    setState('gameover');
  }

  /* ---------------- rendering ---------------- */
  function render() {
    Engine.Canvas.use('gameCanvas');
    const ctx = Engine.Canvas.ctx;
    Engine.Canvas.begin();

    ctx.save();
    if (shake > 0)
      ctx.translate(rand(-1, 1) * shake * 14, rand(-1, 1) * shake * 10);

    drawSky(ctx);
    drawMountains(ctx);
    drawForest(ctx);
    drawGround(ctx);
    drawDeco(ctx);
    drawHazards(ctx);
    drawWalls(ctx);
    drawBamboos(ctx);
    drawPlayer(ctx);
    P.render(ctx);
    drawBanner(ctx);

    ctx.restore();

    if (flash > 0) {
      ctx.fillStyle = 'rgba(228,87,46,' + (flash * 0.55).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }
    // soft vignette
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(20,40,25,0.28)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  function drawSky(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#8fdcff');
    g.addColorStop(0.55, '#c9f0e0');
    g.addColorStop(1, '#e9fbd9');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // sun
    ctx.save();
    ctx.translate(790, 92);
    ctx.rotate(ambient * 0.15);
    ctx.fillStyle = 'rgba(255,224,130,0.55)';
    for (let i = 0; i < 8; i++) {
      ctx.rotate(TAU / 8);
      ctx.fillRect(-6, -64, 12, 26);
    }
    ctx.restore();
    ctx.fillStyle = '#ffe29a';
    ctx.beginPath(); ctx.arc(790, 92, 38, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath(); ctx.arc(778, 80, 12, 0, TAU); ctx.fill();

    // clouds
    for (const c of clouds) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.scale(c.s, c.s);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(0, 0, 22, 0, TAU);
      ctx.arc(24, -8, 17, 0, TAU);
      ctx.arc(48, 0, 20, 0, TAU);
      ctx.arc(24, 8, 20, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawMountains(ctx) {
    const off = (distance * 0.12) % 320;
    ctx.fillStyle = 'rgba(62,137,72,0.35)';
    ctx.beginPath();
    ctx.moveTo(-40, GROUND);
    for (let x = -320; x < W + 320; x += 320) {
      ctx.lineTo(x - off + 160, 208);
      ctx.lineTo(x - off + 320, GROUND);
    }
    ctx.lineTo(W + 40, GROUND);
    ctx.closePath(); ctx.fill();

    const off2 = (distance * 0.2) % 240;
    ctx.fillStyle = 'rgba(45,80,22,0.30)';
    ctx.beginPath();
    ctx.moveTo(-40, GROUND);
    for (let x = -240; x < W + 240; x += 240) {
      ctx.lineTo(x - off2 + 120, 288);
      ctx.lineTo(x - off2 + 240, GROUND);
    }
    ctx.lineTo(W + 40, GROUND);
    ctx.closePath(); ctx.fill();
  }

  function drawForest(ctx) {
    const step = 96;
    const off = (distance * 0.45) % step;
    const base = Math.floor(distance * 0.45 / step);
    for (let i = -1; i < W / step + 2; i++) {
      const wi = base + i;
      const x = i * step - off + hash(wi) * 40;
      const hgt = 150 + hash(wi * 3.7) * 110;
      const sway = Math.sin(ambient * 1.2 + wi) * 3;
      ctx.strokeStyle = 'rgba(46,110,60,0.5)';
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(x, GROUND);
      ctx.quadraticCurveTo(x + sway, GROUND - hgt * 0.6, x + sway * 2, GROUND - hgt);
      ctx.stroke();
      // nodes
      ctx.strokeStyle = 'rgba(30,80,40,0.45)';
      ctx.lineWidth = 3;
      for (let k = 1; k <= 3; k++) {
        const ny = GROUND - (hgt * k) / 4;
        ctx.beginPath();
        ctx.moveTo(x - 6 + sway * (k / 4), ny);
        ctx.lineTo(x + 6 + sway * (k / 4), ny);
        ctx.stroke();
      }
      // leaf crown
      ctx.fillStyle = 'rgba(62,137,72,0.5)';
      ctx.beginPath();
      ctx.ellipse(x + sway * 2 - 12, GROUND - hgt + 6, 16, 7, -0.5, 0, TAU);
      ctx.ellipse(x + sway * 2 + 12, GROUND - hgt + 4, 16, 7, 0.5, 0, TAU);
      ctx.fill();
    }
  }

  function drawGround(ctx) {
    // dirt
    ctx.fillStyle = '#9c6b3f';
    ctx.fillRect(0, GROUND, W, H - GROUND);
    // speckles (world-locked)
    const step = 52;
    const off = distance % step;
    const base = Math.floor(distance / step);
    ctx.fillStyle = 'rgba(90,55,28,0.5)';
    for (let i = -1; i < W / step + 2; i++) {
      for (let r = 0; r < 2; r++) {
        const wi = base + i;
        const x = i * step - off + hash(wi * 1.3 + r * 77) * 40;
        const y = GROUND + 16 + hash(wi * 2.9 + r * 31) * (H - GROUND - 24);
        ctx.fillRect(x, y, 7, 4);
      }
    }
    // grass top
    ctx.fillStyle = '#79c05f';
    ctx.fillRect(0, GROUND, W, 16);
    ctx.fillStyle = '#5da344';
    ctx.fillRect(0, GROUND + 14, W, 5);
    // grass blades
    const gstep = 26;
    const goff = distance % gstep;
    const gbase = Math.floor(distance / gstep);
    ctx.strokeStyle = '#8ed473';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = -1; i < W / gstep + 2; i++) {
      const wi = gbase + i;
      const x = i * gstep - goff;
      const hh = 6 + hash(wi * 5.1) * 8;
      ctx.moveTo(x, GROUND + 2);
      ctx.lineTo(x + 3, GROUND + 2 - hh);
    }
    ctx.stroke();
  }

  function drawDeco(ctx) {
    for (const d of deco) {
      ctx.save();
      ctx.translate(d.x, GROUND + 2);
      ctx.scale(d.s, d.s);
      if (d.kind === 0) {            // flower
        ctx.strokeStyle = '#4d9427'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -16); ctx.stroke();
        ctx.fillStyle = choice(['#ff8fab', '#ffd166', '#fff6e0']);
        for (let k = 0; k < 5; k++) {
          ctx.beginPath();
          ctx.arc(Math.cos(k * 1.256) * 5, -16 + Math.sin(k * 1.256) * 5, 4, 0, TAU);
          ctx.fill();
        }
        ctx.fillStyle = '#c98a1b';
        ctx.beginPath(); ctx.arc(0, -16, 3, 0, TAU); ctx.fill();
      } else if (d.kind === 1) {     // grass tuft
        ctx.strokeStyle = '#5da344'; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-5, 0); ctx.lineTo(-8, -12);
        ctx.moveTo(0, 0); ctx.lineTo(0, -15);
        ctx.moveTo(5, 0); ctx.lineTo(8, -11);
        ctx.stroke();
      } else {                       // pebble
        ctx.fillStyle = '#b9a184';
        ctx.beginPath(); ctx.ellipse(0, -3, 8, 5, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#8f7a5f';
        ctx.beginPath(); ctx.ellipse(2, -2, 4, 2.5, 0, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawWalls(ctx) {
    for (const w of walls) {
      for (let x = 0; x < w.w; x += 16) {              // bamboo palisade stalks
        const g = ctx.createLinearGradient(w.x + x, 0, w.x + x + 16, 0);
        g.addColorStop(0, '#4d9427');
        g.addColorStop(0.45, '#8ed473');
        g.addColorStop(1, '#3e7a1e');
        ctx.fillStyle = g;
        roundRect(ctx, w.x + x + 1, w.top, 14, w.h, 6);
        ctx.fill();
        ctx.strokeStyle = '#2d5016';
        ctx.lineWidth = 2;
        roundRect(ctx, w.x + x + 1, w.top, 14, w.h, 6);
        ctx.stroke();
        ctx.beginPath();
        for (let ny = w.top + 26; ny < GROUND - 8; ny += 34) {
          ctx.moveTo(w.x + x + 1, ny);
          ctx.lineTo(w.x + x + 15, ny);
        }
        ctx.stroke();
      }
      ctx.fillStyle = '#5da344';                       // cap beam
      roundRect(ctx, w.x - 4, w.top - 10, w.w + 8, 14, 7);
      ctx.fill();
      ctx.strokeStyle = '#2d5016';
      ctx.lineWidth = 2;
      roundRect(ctx, w.x - 4, w.top - 10, w.w + 8, 14, 7);
      ctx.stroke();
      ctx.fillStyle = '#6abe30';                       // leaf fringe
      for (let x = 6; x < w.w; x += 18) {
        ctx.beginPath();
        ctx.ellipse(w.x + x, w.top - 14, 10, 4, -0.4, 0, TAU);
        ctx.ellipse(w.x + x + 8, w.top - 12, 10, 4, 0.4, 0, TAU);
        ctx.fill();
      }
      const pulse = 0.5 + Math.sin(ambient * 5) * 0.3; // climb-hint chevrons
      ctx.strokeStyle = 'rgba(255,246,224,' + pulse.toFixed(2) + ')';
      ctx.lineWidth = 4;
      const cx = w.x + w.w / 2;
      for (let k = 0; k < 2; k++) {
        const cy = w.top + w.h * 0.45 + k * 22;
        ctx.beginPath();
        ctx.moveTo(cx - 10, cy + 8);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx + 10, cy + 8);
        ctx.stroke();
      }
    }
  }

  function drawBamboos(ctx) {
    for (const b of bamboos) {
      const y = b.y + Math.sin(b.ph) * 4;
      ctx.save();
      ctx.translate(b.x, y);
      // glow
      const pulse = 0.5 + Math.sin(b.ph * 2) * 0.2;
      const g = ctx.createRadialGradient(0, 0, 4, 0, 0, 34);
      g.addColorStop(0, 'rgba(184,236,98,' + (0.4 * pulse).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(184,236,98,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, 34, 0, TAU); ctx.fill();
      // stalk
      const sg = ctx.createLinearGradient(-8, 0, 8, 0);
      sg.addColorStop(0, '#4d9427');
      sg.addColorStop(0.4, '#b8ec62');
      sg.addColorStop(1, '#4d9427');
      ctx.fillStyle = sg;
      roundRect(ctx, -8, -30, 16, 60, 7);
      ctx.fill();
      ctx.strokeStyle = '#2d5016';
      ctx.lineWidth = 2.5;
      roundRect(ctx, -8, -30, 16, 60, 7);
      ctx.stroke();
      // nodes
      ctx.beginPath();
      ctx.moveTo(-8, -10); ctx.lineTo(8, -10);
      ctx.moveTo(-8, 10); ctx.lineTo(8, 10);
      ctx.stroke();
      // leaves
      ctx.fillStyle = '#6abe30';
      ctx.beginPath(); ctx.ellipse(-13, -28, 11, 5, -0.6, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(13, -24, 11, 5, 0.6, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }

  function groundShadow(ctx, cx, feetY, w, alpha) {
    ctx.save();
    ctx.fillStyle = 'rgba(30,60,30,' + alpha.toFixed(3) + ')';
    ctx.beginPath();
    ctx.ellipse(cx, feetY, w, w * 0.28, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawHazards(ctx) {
    for (const hz of hazards) {
      const cx = hz.x + hz.w / 2;
      const feet = hz.y + hz.h;
      const airH = GROUND - feet;
      groundShadow(ctx, cx, GROUND + 6, 34 * clamp(1 - airH / 300, 0.3, 1),
        0.28 * clamp(1 - airH / 300, 0.25, 1));
      ctx.save();
      ctx.translate(cx, feet);
      const lean = hz.type === 'run' ? -0.10 : -0.05;
      ctx.rotate(lean);
      let sy = 1, sx = 1;
      if (hz.type === 'hop') {
        const s = hz.squash || 0;
        sy = 1 + s * 0.10;
        sx = 1 - s * 0.06;
      } else {
        sy = 1 + Math.sin(hz.ph) * 0.045;
        sx = 1 - Math.sin(hz.ph) * 0.035;
      }
      ctx.scale(sx, sy);
      Sprites.draw(ctx, 'dudu', -hz.w / 2 - 8, -hz.h - 12, hz.w + 16, hz.h + 12);
      ctx.restore();
      // the heroine chases out of love: a little heart bobs above her
      ctx.fillStyle = 'rgba(255,143,171,0.95)';
      heartPath(ctx, cx, hz.y - 16 + Math.sin(ambient * 5 + hz.ph) * 3,
        7 + Math.sin(ambient * 6 + hz.ph) * 1.3);
      ctx.fill();
    }
  }

  function heartPath(ctx, x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.8);
    ctx.bezierCurveTo(x - s * 1.1, y - s * 0.2, x - s * 0.6, y - s * 1.05, x, y - s * 0.35);
    ctx.bezierCurveTo(x + s * 0.6, y - s * 1.05, x + s * 1.1, y - s * 0.2, x, y + s * 0.8);
    ctx.closePath();
  }

  function drawPlayer(ctx) {
    const h = player.crouching ? PLAYER.crouchH : PLAYER.h;
    const cx = player.x + PLAYER.w / 2;
    const feet = player.y + h;
    const airH = GROUND - feet;
    groundShadow(ctx, cx, GROUND + 6, 30 * clamp(1 - airH / 300, 0.3, 1),
      0.3 * clamp(1 - airH / 300, 0.25, 1));

    if (invuln > 0 && Math.floor(ambient * 14) % 2 === 0 && state === 'playing') {
      ctx.globalAlpha = 0.35;
    }
    ctx.save();
    ctx.translate(cx, feet);
    let sx = 1, sy = 1;
    if (!player.onGround) {
      const st = clamp(Math.abs(player.vy) / 900, 0, 1);
      sy = 1 + st * 0.14; sx = 1 - st * 0.09;
    } else if (player.crouching) {
      sy = 0.94; sx = 1.1;
    } else {
      const bob = Math.sin(player.runPhase * 2) * 0.03;
      sy = 1 + bob; sx = 1 - bob;
    }
    sy += player.squash * -0.6; sx += player.squash * 0.5;
    ctx.rotate(clamp(player.vx * 0.00045, -0.16, 0.16));
    ctx.scale(sx * player.facing, sy);
    const dw = PLAYER.w + 30, dh = h + (player.crouching ? 26 : 18);
    Sprites.draw(ctx, 'bubu', -dw / 2, -dh, dw, dh);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawBanner(ctx) {
    if (readyT <= 0 || !banner) return;
    const t = clamp(readyT, 0, 1);
    ctx.save();
    ctx.globalAlpha = clamp(readyT * 2, 0, 1);
    ctx.translate(W / 2, H * 0.4);
    const pop = 1 + (1 - t) * 0.15;
    ctx.scale(pop, pop);
    ctx.font = "34px 'Press Start 2P', monospace";
    ctx.textAlign = 'center';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(45,80,22,0.9)';
    ctx.strokeText(banner, 0, 0);
    ctx.fillStyle = '#ffd166';
    ctx.fillText(banner, 0, 0);
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------------- main update ---------------- */
  function update(dt) {
    if (state === 'playing') updateWorld(dt);
    else {
      ambient += dt;
      for (const c of clouds) {
        c.x -= c.v * dt;
        if (c.x < -140) { c.x = W + rand(40, 160); c.y = rand(40, 190); }
      }
      P.update(dt);
      if (state === 'menu') {
        // idle Bubu breathing on the menu backdrop
        player.runPhase += dt * 2;
      }
    }
  }

  /* ---------------- flow ---------------- */
  function startGame() {
    resetWorld(true);
    setState('playing');
  }

  function nextLevel() {
    level++;
    resetWorld(false);
    setState('playing');
  }

  function pauseGame() {
    if (state !== 'playing') return;
    setState('paused');
  }

  function resumeGame() {
    if (state !== 'paused') return;
    setState('playing');
  }

  function toMenu() {
    hazards = []; bamboos = [];
    P.clear();
    player.x = PLAYER.startX;
    player.y = GROUND - PLAYER.h;
    player.crouching = false;
    invuln = 0; flash = 0; shake = 0; readyT = 0; banner = '';
    setState('menu');
  }

  /* ---------------- boot ---------------- */
  function boot() {
    clamp = Engine.clamp; lerp = Engine.lerp; rand = Engine.rand;
    randInt = Engine.randInt; choice = Engine.choice; aabb = Engine.aabb;
    hash = Engine.hash; TAU = Engine.TAU;
    P = Engine.createParticles(); AU = Engine.Audio; IN = Engine.Input;

    dom.score = $('score'); dom.lives = $('lives'); dom.level = $('level');
    dom.finalScore = $('finalScore'); dom.highScore = $('highScore');
    dom.levelScore = $('levelScore');
    screens.menu = $('startScreen');
    screens.how = $('howToScreen');
    screens.paused = $('pauseScreen');
    screens.gameover = $('gameOverScreen');
    screens.levelcomplete = $('levelCompleteScreen');

    try { highScore = parseInt(localStorage.getItem('bubuHighScore') || '0', 10) || 0; }
    catch (e) { highScore = 0; }

    Engine.Canvas.init($('gameCanvas'));
    IN.init();
    initClouds();
    resetWorld(true);
    readyT = 0; banner = '';

    /* buttons */
    const on = (id, fn) => {
      const el = $(id);
      if (el) el.addEventListener('click', () => {
        el.blur();                 // don't keep focus (Enter/Space re-triggers)
        AU.unlock(); AU.sfx.click(); fn();
      });
    };
    on('startBtn', startGame);
    on('howToPlayBtn', () => setState('how'));
    on('backToStartBtn', () => setState('menu'));
    on('pauseBtn', pauseGame);
    on('resumeBtn', resumeGame);
    on('quitBtn', toMenu);
    on('playAgainBtn', startGame);
    on('menuBtn', toMenu);
    on('nextLevelBtn', nextLevel);
    on('tagModeBtn', () => {
      if (window.showPage) window.showPage('tag');          // single-file mode
      else window.location.href = 'tag.html';              // multi-file mode
    });

    /* keyboard shortcuts for pause */
    window.addEventListener('keydown', (e) => {
      if (window.PAGE && window.PAGE !== 'runner') return;   // single-file mode guard
      if (e.code === 'KeyP' || e.code === 'Escape') {
        if (state === 'playing') { AU.sfx.click(); pauseGame(); }
        else if (state === 'paused') { AU.sfx.click(); resumeGame(); }
      }
      if (e.code === 'Enter' && state === 'menu') startGame();
    });
    document.addEventListener('visibilitychange', () => {
      if (window.PAGE && window.PAGE !== 'runner') return;
      if (document.hidden && state === 'playing') pauseGame();
    });

    /* touch buttons */
    const hold = (id, prop) => {
      const el = $(id);
      if (!el) return;
      const down = (e) => { e.preventDefault(); AU.unlock(); IN.touch[prop] = true; };
      const up = (e) => { e.preventDefault(); IN.touch[prop] = false; };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('pointerleave', up);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    hold('leftBtn', 'left');
    hold('rightBtn', 'right');
    const jb = $('jumpBtn');
    if (jb) {
      jb.addEventListener('pointerdown', (e) => { e.preventDefault(); AU.unlock(); IN.queue('jump'); });
      jb.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    /* canvas swipes: tap = jump, swipe down = crouch */
    const cv = $('gameCanvas');
    let tStart = null;
    cv.addEventListener('touchstart', (e) => {
      AU.unlock();
      const t = e.changedTouches[0];
      tStart = { x: t.clientX, y: t.clientY, t: performance.now() };
    }, { passive: true });
    cv.addEventListener('touchmove', (e) => {
      if (!tStart) return;
      const t = e.changedTouches[0];
      const dy = t.clientY - tStart.y;
      IN.touch.crouch = dy > 34;
      if (dy > 34) e.preventDefault();
    }, { passive: false });
    cv.addEventListener('touchend', (e) => {
      if (tStart) {
        const t = e.changedTouches[0];
        const dy = t.clientY - tStart.y;
        const dx = Math.abs(t.clientX - tStart.x);
        if (dy < 12 && dx < 24 && performance.now() - tStart.t < 260) IN.queue('jump');
      }
      IN.touch.crouch = false;
      tStart = null;
    });

    /* loading screen → menu */
    const bar = $('loadingProgress');
    Sprites.load((p) => { if (bar) bar.style.width = Math.round(p * 100) + '%'; })
      .then(() => new Promise((r) => setTimeout(r, 450)))
      .then(() => {
        const ls = $('loadingScreen');
        if (ls) ls.classList.add('hidden');
        setState('menu');
        Engine.Loop.start(update, render);
      });
  }

  return { boot, pause: pauseGame, getState: () => state };
})();
