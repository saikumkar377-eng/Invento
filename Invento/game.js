// --- CONFIGURATION ---
const CONFIG = {
    gravity: 0.8,
    jumpForce: -14,
    groundY: 0,
    speedStart: 6,
    speedIncrement: 0.002,
    shieldDrain: 0.8,
    shieldRegen: 0.3
};

const HIGHSCORE_STORAGE_KEY = 'oth_highscore';
const SKIN_STORAGE_KEY = 'oth_skin';
const SOUND_STORAGE_KEY = 'oth_sound';

const Storage = {
    get(key, fallback = null) {
        try {
            const value = window.localStorage ? window.localStorage.getItem(key) : null;
            return value === null ? fallback : value;
        } catch (error) {
            return fallback;
        }
    },
    set(key, value) {
        try {
            if (!window.localStorage) return false;
            window.localStorage.setItem(key, String(value));
            return true;
        } catch (error) {
            return false;
        }
    }
};

function createAudio(src, options = {}) {
    try {
        const audio = new Audio(src);
        audio.preload = 'auto';
        if (typeof options.loop === 'boolean') audio.loop = options.loop;
        if (typeof options.volume === 'number') audio.volume = options.volume;
        return audio;
    } catch (error) {
        return null;
    }
}

const storedSound = Storage.get(SOUND_STORAGE_KEY, null);
const initialSoundEnabled = storedSound === null ? true : storedSound === '1';

const SKINS = {
    ball: { color: '#13ec5b', glow: 'rgba(19, 236, 91, 0.6)', shape: 'circle' },
    human: { color: '#facc15', glow: 'rgba(250, 204, 21, 0.6)', shape: 'square' },
    animal: { color: '#f472b6', glow: 'rgba(244, 114, 182, 0.6)', shape: 'circle' }
};

// --- SOUNDS ---
const Sounds = {
    enabled: initialSoundEnabled,
    menuBgm: createAudio('assets/audio/Homepage.mp3', { loop: true, volume: 0.4 }),
    button: createAudio('assets/audio/Button.mp3', { volume: 0.7 }),
    bgm: createAudio('assets/audio/Playing.mp3', { loop: true, volume: 0.4 }),
    jump: createAudio('assets/audio/Jump.mp3'),
    shield: createAudio('assets/audio/Button.mp3', { volume: 0.45 }),
    death: createAudio('assets/audio/Death.mp3'),

    play(sound) {
        if (!this.enabled || !sound) return;
        sound.currentTime = 0;
        const playPromise = sound.play();
        if (playPromise && playPromise.catch) playPromise.catch(() => {}); // Catch browser auto-play blocks
    },
    toggle() {
        setSoundEnabled(!this.enabled);
        return this.enabled;
    }
};

let audioUnlocked = false;
function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    const allAudio = [Sounds.jump, Sounds.death, Sounds.shield, Sounds.bgm, Sounds.menuBgm, Sounds.button];
    allAudio.forEach((audio) => {
        if (!audio) return;
        const wasMuted = audio.muted;
        audio.muted = true;
        const playPromise = audio.play();
        if (playPromise && playPromise.then) {
            playPromise.then(() => {
                audio.pause();
                audio.currentTime = 0;
                audio.muted = wasMuted;
            }).catch(() => {
                audio.muted = wasMuted;
            });
        } else {
            audio.pause();
            audio.currentTime = 0;
            audio.muted = wasMuted;
        }
    });
}

// --- STATE ---
const State = {
    screen: 'menu',
    score: 0,
    // Ensure high score is read as a whole number
    highScore: parseInt(Storage.get(HIGHSCORE_STORAGE_KEY, '0'), 10) || 0,
    skin: Storage.get(SKIN_STORAGE_KEY, 'ball') || 'ball',
    frames: 0,
    speed: CONFIG.speedStart,
    gameLoopId: null,
    shieldUnlocked: false,
    unlockAnimation: 0,
    viewWidth: window.innerWidth,
    viewHeight: window.innerHeight
};

function setSoundEnabled(enabled) {
    Sounds.enabled = enabled;
    const muted = !enabled;
    [Sounds.jump, Sounds.death, Sounds.shield, Sounds.bgm, Sounds.menuBgm, Sounds.button].forEach((audio) => {
        if (!audio) return;
        audio.muted = muted;
    });
    if (muted) {
        safePause(Sounds.bgm);
        safePause(Sounds.menuBgm);
    } else {
        updateBgmForScreen();
    }
    Storage.set(SOUND_STORAGE_KEY, enabled ? '1' : '0');
}

function safePause(audio) {
    if (audio && audio.pause) audio.pause();
}

function safePlay(audio) {
    if (!audio || !audio.play) return;
    const playPromise = audio.play();
    if (playPromise && playPromise.catch) playPromise.catch(() => {});
}

function updateBgmForScreen() {
    if (!Sounds.enabled) return;
    if (State.screen === 'playing') {
        safePause(Sounds.menuBgm);
        safePlay(Sounds.bgm);
    } else if (State.screen === 'menu' || State.screen === 'skins') {
        safePause(Sounds.bgm);
        safePlay(Sounds.menuBgm);
    } else {
        safePause(Sounds.bgm);
        safePause(Sounds.menuBgm);
    }
}

// --- ENTITIES ---
const Hero = {
    x: 50,
    y: 0,
    vy: 0,
    radius: 15,
    grounded: false,
    shielding: false,
    shieldEnergy: 100,
    skin: State.skin,
    color: SKINS[State.skin] ? SKINS[State.skin].color : SKINS.ball.color
};

let Obstacles = [];
let Particles = [];

// --- SETUP ---
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const uiScores = {
    display: document.getElementById('score-display'),
    final: document.getElementById('final-score'),
    best: document.getElementById('final-best'),
    menuBest: document.getElementById('menu-best-score'),
    shieldBar: document.getElementById('shield-bar'),
    shieldHint: document.getElementById('shield-hint'),
    shieldContainer: document.getElementById('shield-container')
};
const muteIcon = document.getElementById('mute-btn');

if (uiScores.menuBest) uiScores.menuBest.innerText = State.highScore;

function updateMuteIcon() {
    if (muteIcon) muteIcon.textContent = Sounds.enabled ? 'volume_up' : 'volume_off';
}

setSoundEnabled(Sounds.enabled);
updateMuteIcon();

function setShieldHintVisible(visible) {
    if (!uiScores.shieldHint) return;
    uiScores.shieldHint.classList.toggle('hidden', !visible);
}

function setShieldContainerLocked(locked) {
    if (!uiScores.shieldContainer) return;
    uiScores.shieldContainer.style.opacity = locked ? '0.3' : '1';
}

const skinButtons = {
    ball: document.getElementById('btn-skin-ball'),
    human: document.getElementById('btn-skin-human'),
    animal: document.getElementById('btn-skin-animal')
};
const menuHeroPreview = document.getElementById('menu-hero-preview');

function getSkinConfig(skin) {
    return SKINS[skin] || SKINS.ball;
}

function updateSkinButtons(selected) {
    Object.entries(skinButtons).forEach(([key, btn]) => {
        if (!btn) return;
        const isSelected = key === selected;
        btn.classList.toggle('border-primary', isSelected);
        btn.classList.toggle('border-transparent', !isSelected);
        const check = btn.querySelector('[data-skin-check]');
        if (check) check.classList.toggle('hidden', !isSelected);
        btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    });
}

function updateMenuPreview() {
    if (!menuHeroPreview) return;
    const previewShape = menuHeroPreview.firstElementChild;
    if (!previewShape) return;
    const skinConfig = getSkinConfig(Hero.skin);
    previewShape.style.backgroundColor = skinConfig.color;
    previewShape.style.boxShadow = `0 0 20px ${skinConfig.glow}`;
    previewShape.style.borderRadius = skinConfig.shape === 'square' ? '12px' : '9999px';
}

function applySkin(skin) {
    const resolvedSkin = SKINS[skin] ? skin : 'ball';
    const skinConfig = getSkinConfig(resolvedSkin);
    Hero.skin = resolvedSkin;
    Hero.color = skinConfig.color;
    State.skin = resolvedSkin;
    Storage.set(SKIN_STORAGE_KEY, resolvedSkin);
    updateSkinButtons(resolvedSkin);
    updateMenuPreview();
}

applySkin(State.skin);

function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    State.viewWidth = window.innerWidth;
    State.viewHeight = window.innerHeight;
    CONFIG.groundY = State.viewHeight - (State.viewHeight * 0.2); 
    Hero.x = State.viewWidth * 0.15;
}
window.addEventListener('resize', resize);
resize();

// --- FIXED INPUT HANDLING (INSTANT JUMP) ---
let touchStart = 0;
let isTouching = false;
let pendingJump = false;
const touchZone = document.getElementById('touch-zone');

const startInput = () => {
    if (State.screen !== 'playing') return;
    unlockAudio();
    touchStart = Date.now();
    isTouching = true;

    // If shield is unlocked, wait to see if it's a hold (shield) or tap (jump)
    if (State.shieldUnlocked) {
        pendingJump = Hero.grounded;
        return;
    }

    // Otherwise, jump instantly for responsiveness
    if (Hero.grounded) {
        Hero.vy = CONFIG.jumpForce;
        Hero.grounded = false;
        Sounds.play(Sounds.jump);
        spawnParticles(Hero.x, Hero.y + Hero.radius, 5, '#fff');
    }
};

const endInput = () => {
    if (State.screen !== 'playing') return;
    const pressDuration = Date.now() - touchStart;
    isTouching = false;

    if (State.shieldUnlocked) {
        if (pendingJump && pressDuration < 150 && Hero.grounded) {
            Hero.vy = CONFIG.jumpForce;
            Hero.grounded = false;
            Sounds.play(Sounds.jump);
            spawnParticles(Hero.x, Hero.y + Hero.radius, 5, '#fff');
        }
        pendingJump = false;
    }

    Hero.shielding = false;
};

function bindInputEvents() {
    if (!touchZone) return;
    if (window.PointerEvent) {
        const onPointerDown = (e) => {
            if (e.button !== undefined && e.button !== 0) return;
            e.preventDefault();
            if (touchZone.setPointerCapture) touchZone.setPointerCapture(e.pointerId);
            startInput();
        };
        const onPointerUp = (e) => {
            e.preventDefault();
            if (touchZone.releasePointerCapture) touchZone.releasePointerCapture(e.pointerId);
            endInput();
        };
        const onPointerCancel = (e) => {
            e.preventDefault();
            if (touchZone.releasePointerCapture) touchZone.releasePointerCapture(e.pointerId);
            endInput();
        };
        touchZone.addEventListener('pointerdown', onPointerDown, { passive: false });
        touchZone.addEventListener('pointerup', onPointerUp, { passive: false });
        touchZone.addEventListener('pointercancel', onPointerCancel, { passive: false });
        touchZone.addEventListener('pointerleave', onPointerCancel, { passive: false });
    } else {
        touchZone.addEventListener('mousedown', (e) => { e.preventDefault(); startInput(); });
        touchZone.addEventListener('mouseup', (e) => { e.preventDefault(); endInput(); });
        touchZone.addEventListener('touchstart', (e) => { e.preventDefault(); startInput(); }, { passive: false });
        touchZone.addEventListener('touchend', (e) => { e.preventDefault(); endInput(); }, { passive: false });
        touchZone.addEventListener('touchcancel', (e) => { e.preventDefault(); endInput(); }, { passive: false });
    }
}
bindInputEvents();

function pauseGame() {
    if (State.screen !== 'playing') return;
    State.screen = 'paused';
    safePause(Sounds.bgm);
    safePause(Sounds.menuBgm);
    cancelAnimationFrame(State.gameLoopId);
    switchScreen('pause-screen');
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseGame();
});
window.addEventListener('blur', () => {
    pauseGame();
});
window.addEventListener('pagehide', () => {
    pauseGame();
});

// --- GAME LOGIC ---
const Game = {
    click: () => {
        unlockAudio();
        Sounds.play(Sounds.button);
    },
    start: () => {
        Game.click();
        unlockAudio();
        switchScreen('game-screen');
        State.screen = 'playing';
        updateBgmForScreen();
        State.score = 0;
        State.frames = 0;
        State.speed = CONFIG.speedStart;
        State.shieldUnlocked = false; 
        State.unlockAnimation = 0;

        Hero.y = CONFIG.groundY - Hero.radius;
        Hero.vy = 0;
        Hero.shieldEnergy = 100;
        Hero.grounded = true;
        Hero.shielding = false;
        isTouching = false;
        touchStart = 0;
        pendingJump = false;
        setShieldHintVisible(true);
        setShieldContainerLocked(true);

        Obstacles = [];
        Particles = [];
        
        if (Sounds.bgm) Sounds.bgm.currentTime = 0;

        Game.loop();
    },

    restart: () => { Game.start(); },

    home: () => {
        Game.click();
        switchScreen('menu-screen');
        State.screen = 'menu';
        updateBgmForScreen();
        if (uiScores.menuBest) uiScores.menuBest.innerText = State.highScore;
    },

    openSkins: () => {
        Game.click();
        switchScreen('skin-screen');
        State.screen = 'skins';
        updateBgmForScreen();
    },

    setSkin: (skin) => {
        Game.click();
        applySkin(skin);
    },

    togglePause: () => {
        Game.click();
        if (State.screen === 'playing') {
            pauseGame();
        } else if (State.screen === 'paused') {
            State.screen = 'playing';
            updateBgmForScreen();
            switchScreen('game-screen');
            Game.loop();
        }
    },

    toggleMute: () => {
        Game.click();
        Sounds.toggle();
        updateMuteIcon();
    },

    gameOver: () => {
        State.screen = 'gameover';
        safePause(Sounds.bgm);
        safePause(Sounds.menuBgm);
        Sounds.play(Sounds.death);
        cancelAnimationFrame(State.gameLoopId);

        // Save high score as a whole number
        const finalScore = Math.floor(State.score);
        if (finalScore > State.highScore) {
            State.highScore = finalScore;
            Storage.set(HIGHSCORE_STORAGE_KEY, State.highScore);
        }

        if (uiScores.final) uiScores.final.innerText = finalScore;
        if (uiScores.best) uiScores.best.innerText = State.highScore;
        switchScreen('gameover-screen');
    },

    loop: () => {
        if (State.screen !== 'playing') return;
        updatePhysics();
        draw();
        State.gameLoopId = requestAnimationFrame(Game.loop);
    }
};
window.Game = Game;

function updatePhysics() {
    State.frames++;
    State.score += 0.1;
    State.speed += CONFIG.speedIncrement;

    if (uiScores.display) uiScores.display.innerText = Math.floor(State.score);

    Hero.vy += CONFIG.gravity;
    Hero.y += Hero.vy;

    if (Hero.y + Hero.radius > CONFIG.groundY) {
        Hero.y = CONFIG.groundY - Hero.radius;
        Hero.vy = 0;
        Hero.grounded = true;
    }

    if (!State.shieldUnlocked && State.score >= 200) {
        State.shieldUnlocked = true;
        State.unlockAnimation = 100;
        setShieldHintVisible(false);
        setShieldContainerLocked(false);
        spawnParticles(Hero.x, Hero.y, 30, '#13ec5b');
    }

    if (State.shieldUnlocked) {
        if (isTouching && (Date.now() - touchStart > 150)) {
            if (Hero.shieldEnergy > 0) {
                if (!Hero.shielding) Sounds.play(Sounds.shield);
                Hero.shielding = true;
                pendingJump = false;
                Hero.shieldEnergy -= CONFIG.shieldDrain;
            } else {
                Hero.shielding = false;
            }
        } else {
            Hero.shielding = false;
            if (Hero.shieldEnergy < 100) Hero.shieldEnergy += CONFIG.shieldRegen;
        }
        if (Hero.shieldEnergy > 100) Hero.shieldEnergy = 100;
        if (uiScores.shieldBar) uiScores.shieldBar.style.width = Hero.shieldEnergy + '%';
    }

    // Obstacles
    if (State.frames % Math.floor(1000 / State.speed) === 0 || State.frames === 50) {
        const type = Math.random() > 0.5 ? 'spike' : 'block';
        Obstacles.push({
            x: State.viewWidth,
            y: CONFIG.groundY,
            w: 30,
            h: type === 'spike' ? 40 : 60,
            type: type
        });
    }

    for (let i = Obstacles.length - 1; i >= 0; i--) {
        let obs = Obstacles[i];
        obs.x -= State.speed;
        if (obs.x + obs.w < 0) {
            Obstacles.splice(i, 1);
            continue;
        }
        
        let margin = 5;
        let heroBox = { x: Hero.x - Hero.radius + margin, y: Hero.y - Hero.radius + margin, w: (Hero.radius * 2) - margin*2, h: (Hero.radius * 2) - margin*2 };
        let obsBox = { x: obs.x, y: obs.y - obs.h, w: obs.w, h: obs.h };

        if (rectIntersect(heroBox, obsBox)) {
            if (Hero.shielding) {
                spawnParticles(obs.x, obs.y - obs.h / 2, 10, '#13ec5b');
                Obstacles.splice(i, 1);
                Hero.shieldEnergy -= 30;
                if(Hero.shieldEnergy < 0) Hero.shieldEnergy = 0;
            } else {
                spawnParticles(Hero.x, Hero.y, 20, '#fff');
                Game.gameOver();
            }
        }
    }

    for (let i = Particles.length - 1; i >= 0; i--) {
        let p = Particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.05;
        if (p.life <= 0) Particles.splice(i, 1);
    }
}

function draw() {
    ctx.clearRect(0, 0, State.viewWidth, State.viewHeight);

    ctx.fillStyle = '#112217';
    ctx.fillRect(0, CONFIG.groundY, State.viewWidth, State.viewHeight - CONFIG.groundY);
    ctx.fillStyle = '#13ec5b';
    ctx.fillRect(0, CONFIG.groundY, State.viewWidth, 2);

    Obstacles.forEach(obs => {
        if (obs.type === 'spike') {
            ctx.fillStyle = '#ef4444';
            ctx.beginPath();
            ctx.moveTo(obs.x, obs.y);
            ctx.lineTo(obs.x + obs.w / 2, obs.y - obs.h);
            ctx.lineTo(obs.x + obs.w, obs.y);
            ctx.fill();
        } else {
            ctx.fillStyle = '#facc15';
            ctx.fillRect(obs.x, obs.y - obs.h, obs.w, obs.h);
        }
    });

    if (Hero.shielding) {
        ctx.beginPath();
        ctx.arc(Hero.x, Hero.y, Hero.radius + 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(19, 236, 91, 0.3)';
        ctx.fill();
        ctx.strokeStyle = '#13ec5b';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    drawHero();

    Particles.forEach(p => {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    });

    if (State.unlockAnimation > 0) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.font = "bold 40px 'Spline Sans'";
        ctx.fillStyle = `rgba(19, 236, 91, ${State.unlockAnimation / 100})`;
        ctx.shadowBlur = 15;
        ctx.shadowColor = "#13ec5b";
        const scale = 1 + Math.sin(State.frames * 0.1) * 0.1;
        ctx.translate(State.viewWidth / 2, State.viewHeight / 3);
        ctx.scale(scale, scale);
        ctx.fillText("SHIELD UNLOCKED", 0, 0);
        ctx.restore();
        State.unlockAnimation--;
    }
}

function drawHero() {
    const skinConfig = getSkinConfig(Hero.skin);
    const color = Hero.color || '#fff';
    const r = Hero.radius;

    ctx.save();
    ctx.shadowBlur = 12;
    ctx.shadowColor = skinConfig.glow || 'rgba(255,255,255,0.35)';
    ctx.fillStyle = color;

    if (skinConfig.shape === 'square') {
        const size = r * 2;
        const radius = 6;
        roundRect(ctx, Hero.x - r, Hero.y - r, size, size, radius);
        ctx.fill();
        drawEyes(Hero.x, Hero.y, 4, 5);
    } else if (Hero.skin === 'animal') {
        ctx.beginPath();
        ctx.arc(Hero.x, Hero.y, r, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.ellipse(Hero.x - r * 0.45, Hero.y - r * 0.9, r * 0.25, r * 0.6, 0, 0, Math.PI * 2);
        ctx.ellipse(Hero.x + r * 0.45, Hero.y - r * 0.9, r * 0.25, r * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();

        drawEyes(Hero.x, Hero.y, 3, 4);
    } else {
        ctx.beginPath();
        ctx.arc(Hero.x, Hero.y, r, 0, Math.PI * 2);
        ctx.fill();
        drawEyes(Hero.x, Hero.y, 3, 5);
    }

    ctx.restore();
}

function roundRect(context, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    context.beginPath();
    context.moveTo(x + radius, y);
    context.arcTo(x + w, y, x + w, y + h, radius);
    context.arcTo(x + w, y + h, x, y + h, radius);
    context.arcTo(x, y + h, x, y, radius);
    context.arcTo(x, y, x + w, y, radius);
    context.closePath();
}

function drawEyes(x, y, size, spacing) {
    ctx.save();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(x - spacing, y - 2, size, 0, Math.PI * 2);
    ctx.arc(x + spacing, y - 2, size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function switchScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden-screen'));
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('pointer-events-auto'));
    const target = document.getElementById(id);
    if (target) {
        target.classList.remove('hidden-screen');
        if (id !== 'game-screen') target.classList.add('pointer-events-auto');
    }
}

function rectIntersect(r1, r2) {
    return !(r2.x > r1.x + r1.w || r2.x + r2.w < r1.x || r2.y > r1.y + r1.h || r2.y + r2.h < r1.y);
}

function spawnParticles(x, y, count, color) {
    for (let i = 0; i < count; i++) {
        Particles.push({
            x: x, y: y,
            vx: (Math.random() - 0.5) * 5,
            vy: (Math.random() - 0.5) * 5,
            life: 1.0,
            size: Math.random() * 3,
            color: color
        });
    }
}
