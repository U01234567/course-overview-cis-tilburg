/* =============================================================================
    0) Config
============================================================================= */
const Config = {
    defaultTheme: null,

    minScaleFactor: 0.25,
    maxScaleFactor: 6,

    fitPaddingSmall: 8,
    fitPaddingLarge: 30,
    fitPaddingMax: 80,

    trackLabels: {
        BDM: 'Business Communication & Digital Media',
        CC: 'Communication & Cognition',
        NMD: 'New Media Design'
    },

    lightenDuringMotion: true,

    dockTransitionMs: 280,
    menuHexDelayMs: 200,
    layerTransitionMs: 280,
    introMinDelayMs: 400,

    /* Dock swipe threshold (px) */
    dockSwipePx: 56
};

const HEX_SYMBOL_BY_TRACKS = {
    'BDM': 'hex-bdm',
    'CC': 'hex-cc',
    'NMD': 'hex-nmd',
    'BDM CC': 'hex-cc-bdm',
    'CC NMD': 'hex-cc-nmd',
    'BDM NMD': 'hex-bdm-nmd',
    'BDM CC NMD': 'hex-all'
};

/* =============================================================================
    Utility helpers
============================================================================= */
const Util = {
    clamp(v, min, max) {
        return Math.min(max, Math.max(min, v));
    },

    wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    },

    nextFrame(frames = 1) {
        return new Promise((resolve) => {
            function step(n) {
                if (n <= 0) return resolve();
                requestAnimationFrame(() => step(n - 1));
            }
            step(frames);
        });
    },

    escapeHtml(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    isLandscape() {
        return window.matchMedia('(orientation: landscape)').matches;
    },

    isTouchPrimary() {
        return window.matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    }
};

/* =============================================================================
    1) App root
============================================================================= */
const App = {
    state: {
        scale: 1,
        tx: 0,
        ty: 0,
        min: Config.minScaleFactor,
        max: Config.maxScaleFactor,
        baseScale: 1,
        baseTx: 0,
        baseTy: 0,
        infoBiasTy: 0,

        selection: {
            theme: Config.defaultTheme,
            hiddenIds: new Set()
        },

        focusedId: null,

        dim: { w: 0, h: 0, isSmall: false },
        gridBounds: { width: 0, height: 0 },

        isDragging: false,
        isPinching: false,

        menu: {
            isCollapsed: false,
            userCollapsed: false,
            autoCollapsed: false
        },

        lockInput: false,
        rafId: null
    },

    el: {
        stage: null,
        layer: null,
        workspace: null,
        grid: null,

        themeForm: null,
        centerBtn: null,
        downloadBtn: null,
        legendTheme: null,

        infoPanel: null,
        infoText: null,
        infoCloseBtn: null,

        themeToggleBtn: null,

        dock: null,
        dockHandle: null,
        dockToggleBtn: null,

        themeGroup: null,
        courseGroup: null,

        themeDetails: null,
        courseDetails: null,

        tour: null,
        tourStep: null,
        tourText: null,
        tourPrevBtn: null,
        tourNextBtn: null,
        tourCloseBtn: null,
        tourHideBtn: null,

        toast: null
    },

    cache: {
        hexEls: [],
        hexById: new Map(),
        courseById: new Map(),

        /* Layout extents (computed once on load) */
        layoutExtent: null
    }
};

/* =============================================================================
    2) Layout (positioning; run once on load)
    - If overviewData contains a structure for N courses, use it.
    - Otherwise fall back to auto layout.
    - Always assign positions from top-left to bottom-right (stable order).
============================================================================= */
App.Layout = (function () {
    /* ----- Overview (client-provided structures) ---------------------------- */
    let _overviewCache = null;
    function loadOverview() {
        if (_overviewCache) return _overviewCache;
        if (window.__CIS_OVERVIEW__ && typeof window.__CIS_OVERVIEW__ === 'object') {
            _overviewCache = window.__CIS_OVERVIEW__;
            return _overviewCache;
        }
        try {
            const raw = document.getElementById('overviewData')?.textContent || '{}';
            _overviewCache = JSON.parse(raw) || {};
        } catch (e) {
            console.warn('[overviewData] Failed to parse; falling back to auto layout.', e);
            _overviewCache = {};
        }
        return _overviewCache;
    }

    /**
     * Parse a compact pattern string like: "3-4-{5}-4-3" or "3-2-3-[4]-3-2-3"
     * Rules for clients (also documented next to #overviewData):
     * - Use hyphens (-) between columns, left to right.
     * - Use {x} when the middle column must be ODD (visually offset down by 0.5 row).
     * - Use [x] when the middle column must be EVEN (no visual offset).
     * - Optional alignment skips per column:
     *     '^t'  => skip the TOP-most hex (keep alignment as if height was x)
     *     '^b'  => skip the BOTTOM-most hex
     *   Example: "5^b" means a 5-high column but hide the bottom slot (shows 4).
     */
    function parseOverviewPattern(pattern) {
        if (!pattern || typeof pattern !== 'string') return null;
        const rawTokens = pattern.split('-').map(s => s.trim()).filter(Boolean);
        if (!rawTokens.length) return null;

        // Detect middle token + parity from brackets
        let midIdx = Math.floor(rawTokens.length / 2);
        let middleOdd = null; // true => odd, false => even; null => infer from N later
        function stripBrackets(tok) {
            if (/^\{.+\}$/.test(tok)) { middleOdd = true;  return tok.slice(1, -1).trim(); }
            if (/^\[.+\]$/.test(tok)) { middleOdd = false; return tok.slice(1, -1).trim(); }
            return tok;
        }
        const tokens = rawTokens.map(stripBrackets);

        // Columns: height + optional skip
        const cols = tokens.map(t => {
            const m = /^(\d+)(\^(t|b))?$/.exec(t);
            if (!m) return { h: 0, skip: null };
            const h = parseInt(m[1], 10) || 0;
            const skip = m[3] === 't' ? 'first' : (m[3] === 'b' ? 'last' : null);
            return { h, skip };
        });

        return { columns: cols, middleOdd, colCount: cols.length };
    }

    function generatePositionsFromParsed(N, parsed) {
        if (!parsed || !Array.isArray(parsed.columns) || !parsed.columns.length) return null;
        const columns = parsed.columns;
        const cols = columns.length;
        const D = Math.floor((cols - 1) / 2);
        // Parity: if client specified via []/{}, use that; else default to (N % 2 === 1)
        const middleOdd = (parsed.middleOdd != null) ? !!parsed.middleOdd : ((N % 2) === 1);

        const positions = [];
        for (let qi = 0; qi < cols; qi++) {
            const q = qi - D;
            const oddCol = ((Math.abs(q) + (middleOdd ? 1 : 0)) % 2) === 1;
            const h = Math.max(0, columns[qi].h|0);
            const skip = columns[qi].skip || null;
            const yStart = -((h - 1) / 2);

            for (let i = 0; i < h; i++) {
                if (skip === 'first' && i === 0) continue;
                if (skip === 'last'  && i === h - 1) continue;
                const yK = yStart + i;
                const r  = yK - (q * 0.5) - (oddCol ? 0.5 : 0);
                positions.push({ q, r, odd: oddCol, xKey: q, yKey: yK });
            }
        }

        // Compute extents
        let minQ = Infinity, maxQ = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of positions) {
            minQ = Math.min(minQ, p.q);
            maxQ = Math.max(maxQ, p.q);
            minY = Math.min(minY, p.yKey);
            maxY = Math.max(maxY, p.yKey);
        }
        return { positions, extent: { minQ, maxQ, minY, maxY } };
    }

    function baseSum(H, D) {
        // strict slope: H-|q|, q in [-D..D]
        return (2 * D + 1) * H - (D * (D + 1));
    }

    function maxSum(H, D) {
        // plateau at H for all columns
        return (2 * D + 1) * H;
    }

    function scoreCandidate(N, H, D) {
        const root = Math.sqrt(N + 2);
        const preferD = Math.max(0, H - 2); // prefer truncated diamond edges>=2 when possible
        const w = 2 * D + 1;

        let score = 0;
        score += Math.pow(H - root, 2) * 12;
        score += Math.pow(D - preferD, 2) * 2.5;
        score += w * 0.08;
        score += H * 0.04;
        return score;
    }

    function pickShape(N) {
        const parity = N % 2;

        let best = null;

        for (let H = 2; H <= Math.max(2, N); H++) {
            if ((H % 2) !== parity) continue;

            const Dmax = Math.max(0, H - 1);
            const Dstart = Math.max(0, H - 2);

            // Try more diamond-like first, then reduce width
            for (let D = Dstart; D >= 0; D--) {
                const b = baseSum(H, D);
                const m = maxSum(H, D);

                if (b <= N && N <= m) {
                    const s = scoreCandidate(N, H, D);
                    if (!best || s < best.score) best = { H, D, score: s };
                    break;
                }
            }

            // Also consider the full diamond (edges=1) if it helps
            const Dfull = Dmax;
            const bFull = baseSum(H, Dfull);
            const mFull = maxSum(H, Dfull);
            if (bFull <= N && N <= mFull) {
                const sFull = scoreCandidate(N, H, Dfull);
                if (!best || sFull < best.score) best = { H, D: Dfull, score: sFull };
            }
        }

        if (!best) return { H: N || 2, D: 0 };
        return { H: best.H, D: best.D };
    }

    function canInc(heights, i, incTo) {
        // Ensure Lipschitz (adjacent diff <= 1)
        const L = i - 1;
        const R = i + 1;
        if (L >= 0 && (incTo - heights[L] > 1)) return false;
        if (R < heights.length && (incTo - heights[R] > 1)) return false;
        return true;
    }

    function buildHeights(N) {
        const { H, D } = pickShape(N);

        const cols = 2 * D + 1;
        const mid = D;

        // Base strict slope: H - |q|
        const heights = new Array(cols).fill(0).map((_, idx) => {
            const dist = Math.abs(idx - mid);
            return H - dist;
        });

        let sum = heights.reduce((a, b) => a + b, 0);
        let extra = N - sum;

        // Fill extra by raising symmetric column pairs from center outward.
        // Since symmetry keeps parity correct, extra should be even.
        let safety = 0;
        while (extra > 0 && safety++ < 20000) {
            let changed = false;

            for (let dist = 1; dist <= D; dist++) {
                const i = mid - dist;
                const j = mid + dist;

                if (extra < 2) break;

                if (heights[i] >= H || heights[j] >= H) continue;

                const nextI = heights[i] + 1;
                const nextJ = heights[j] + 1;

                if (!canInc(heights, i, nextI)) continue;
                if (!canInc(heights, j, nextJ)) continue;

                heights[i] = nextI;
                heights[j] = nextJ;

                extra -= 2;
                changed = true;
                break; // restart from nearest-to-center each time for nicer plateaus
            }

            if (!changed) break;
        }

        // Final hard clamp: ensure exact sum (fallback in edge cases)
        sum = heights.reduce((a, b) => a + b, 0);
        if (sum !== N) {
            // As a last resort (very small N), rebuild as a single column.
            return { H: N || 1, D: 0, heights: [N || 1] };
        }

        return { H, D, heights };
    }

    function yKey(q, r) {
        // Mirrors the CSS vertical placement:
        // y = (r + q*0.5)*dy + oddY; and oddY == 0.5*dy for odd q.
        const odd = (Math.abs(q) % 2) === 1;
        return r + (q * 0.5) + (odd ? 0.5 : 0);
    }

    function generatePositions(N, opts = {}) {
        // If caller doesn’t supply, default to: odd N → odd middle; even N → even middle.
        const middleOdd = (opts.middleOdd != null) ? !!opts.middleOdd : ((N % 2) === 1);
        const shape = buildHeights(N);
        const { D, heights } = shape;

        const positions = [];

        // IMPORTANT:
        // Use the middle column as the baseline in "screen-space" (yKey), then derive r.
        // This avoids over/under correcting columns caused by centering each column in r,
        // while CSS applies a q-dependent vertical skew (q*0.5) plus odd-column offset.
        //
        // We build each column centered in yKey, then compute r so that:
        //   yKey(q, r) === desiredYKey
        // => r = desiredYKey - q*0.5 - (odd ? 0.5 : 0)
        for (let qi = 0; qi < heights.length; qi++) {
            const q = qi - D;
            const h = heights[qi];
            // Respect requested middle parity: if middleOdd=true, q=0 (and all even |q|) are the "odd"/offset columns.
            const odd = ((Math.abs(q) + (middleOdd ? 1 : 0)) % 2) === 1;
            
            // Center the column in yKey (screen-space) so the overall silhouette is a true diamond.
            const yStart = -((h - 1) / 2);
            const yOddTerm = odd ? 0.5 : 0;

            for (let i = 0; i < h; i++) {
                const yK = yStart + i; // screen-space row key
                const r = yK - (q * 0.5) - yOddTerm; // derive r so CSS lands on yK

                positions.push({
                    q,
                    r,
                    odd,
                    xKey: q,
                    yKey: yK
                });
            }
        }

        // Top-left → bottom-right ordering
        positions.sort((a, b) => {
            if (a.yKey !== b.yKey) return a.yKey - b.yKey;
            if (a.xKey !== b.xKey) return a.xKey - b.xKey;
            return a.r - b.r;
        });

        const used = positions.slice(0, N);

        // Compute extents for fitting (in q and yKey “grid units”)
        let minQ = Infinity, maxQ = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of used) {
            minQ = Math.min(minQ, p.q);
            maxQ = Math.max(maxQ, p.q);
            minY = Math.min(minY, p.yKey);
            maxY = Math.max(maxY, p.yKey);
        }

        return {
            positions: used,
            extent: { minQ, maxQ, minY, maxY }
        };
    }

    function fmt(n) {
        return Number.isInteger(n) ? String(n) : String(n);
    }

    function applyToCourses(courses) {
        const N = courses.length;
        // Default: auto layout with parity that matches total N (odd ↔ odd middle)
        const defaultMiddleOdd = ((N % 2) === 1);
        const auto = generatePositions(N, { middleOdd: defaultMiddleOdd });
        let positions = auto.positions;
        let extent = auto.extent;

        // Try overview pattern first
        const ov = loadOverview();
        const raw = ov?.[String(N)];
        let parsed = null;
        if (typeof raw === 'string') parsed = parseOverviewPattern(raw);
        else if (raw && typeof raw === 'object' && typeof raw.pattern === 'string') parsed = parseOverviewPattern(raw.pattern);

        if (parsed) {
            const manual = generatePositionsFromParsed(N, parsed);
            if (manual && Array.isArray(manual.positions) && manual.positions.length) {
                // If manual produces fewer positions than N, pad with auto so we ALWAYS place N courses.
                if (manual.positions.length >= N) {
                    positions = manual.positions.slice(0, N);
                    extent = manual.extent;
                } else {
                    const need = N - manual.positions.length;
                    const usedKeys = new Set(manual.positions.map(p => `${p.q}:${p.r}`));
                    // IMPORTANT: make padding honor the same middle parity the client asked for.
                    const padParity = (parsed.middleOdd != null) ? !!parsed.middleOdd : defaultMiddleOdd;
                    const autoPad = generatePositions(N, { middleOdd: padParity });
                    const pad = [];
                    for (const p of autoPad.positions) {
                        const k = `${p.q}:${p.r}`;
                        if (!usedKeys.has(k)) {
                            pad.push(p);
                            if (pad.length === need) break;
                        }
                    }
                    positions = manual.positions.concat(pad);
                    // recompute extents over the combined set
                    let minQ = Infinity, maxQ = -Infinity, minY = Infinity, maxY = -Infinity;
                    for (const p of positions) {
                        minQ = Math.min(minQ, p.q);
                        maxQ = Math.max(maxQ, p.q);
                        minY = Math.min(minY, p.yKey ?? (p.r + (p.q * 0.5) + ((Math.abs(p.q) % 2) ? 0.5 : 0)));
                        maxY = Math.max(maxY, p.yKey ?? (p.r + (p.q * 0.5) + ((Math.abs(p.q) % 2) ? 0.5 : 0)));
                    }
                    extent = { minQ, maxQ, minY, maxY };
                }
            }
        }

        for (let i = 0; i < courses.length; i++) {
            const c = courses[i];
            const p = positions[i];

            c._pos = { q: p.q, r: p.r, odd: p.odd };
            c.style = `--q:${fmt(p.q)};--r:${fmt(p.r)}`;
        }

        return extent;
    }

    return { applyToCourses };
})();

/* =============================================================================
    3) Domain (Courses)
============================================================================= */
App.Domain = (function () {
    let _all = [];

    function makeGeneratedId(i) {
        // Stable per load, deterministic by order in coursesData
        return `C${String(i + 1).padStart(3, '0')}`;
    }

    function load() {
        let list = Array.isArray(window.__CIS_COURSES__) ? window.__CIS_COURSES__ : [];
        if (!list.length) {
            const raw = document.getElementById('coursesData')?.textContent || '[]';
            try { list = JSON.parse(raw); } catch (_) { list = []; }
        }

        const normalized = [];

        for (let i = 0; i < (Array.isArray(list) ? list.length : 0); i++) {
            const src = list[i];
            const it = { ...(src && typeof src === 'object' ? src : {}) };

            it.tracks = Array.isArray(it.tracks) ? it.tracks : [];
            it.themes = Array.isArray(it.themes) ? it.themes : [];
            it.block = Array.isArray(it.block) ? it.block : [];

            it.id = makeGeneratedId(i);

            it.title = String(it.title || '').trim();
            it.code = String(it.code ?? '').trim();
            it.description = String(it.description ?? '');

            it.style = '';

            if (!it.title) it.title = `Course ${i + 1}`;

            it._dataset = {
                tracksAttr: it.tracks.map(s => String(s).toUpperCase().trim()).filter(Boolean).join(' '),
                themesAttr: it.themes.map(s => String(s).trim()).filter(Boolean).join(' ')
            };

            it._label = it.title;

            normalized.push(it);
        }

        // Apply auto layout ONCE (no runtime recomputation)
        const extent = App.Layout.applyToCourses(normalized);

        _all = normalized;
        App.cache.courseById = new Map(_all.map(c => [c.id, c]));
        App.cache.layoutExtent = extent;
    }

    function all() {
        return _all;
    }

    return { load, all };
})();

/* =============================================================================
    4) Themes (deduplicated)
============================================================================= */
App.Themes = (function () {
    let _all = [];

    function load() {
        let parsed = Array.isArray(window.__CIS_THEMES__) ? window.__CIS_THEMES__ : [];
        if (!parsed.length) {
            const raw = document.getElementById('themesData')?.textContent || '[]';
            try { parsed = JSON.parse(raw); } catch (_) { parsed = []; }
        }
        const byId = new Map();

        for (const t of Array.isArray(parsed) ? parsed : []) {
            let id = '';
            let label = '';
            let order = Infinity;

            if (typeof t === 'string') {
                id = t.trim();
                label = id;
            } else if (t && typeof t === 'object') {
                id = String(t.id || t.label || '').trim();
                label = String(t.label || id).trim();
                order = Number.isFinite(t.order) ? t.order : Infinity;
            }

            if (!id) continue;

            if (!byId.has(id)) {
                byId.set(id, { id, label, order });
            } else {
                const prev = byId.get(id);
                const bestOrder = Math.min(prev.order, order);
                byId.set(id, { id, label: prev.label || label, order: bestOrder });
            }
        }

        _all = [...byId.values()].sort((a, b) => (a.order - b.order) || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
    }

    function all() {
        return _all;
    }

    return { load, all };
})();

/* =============================================================================
    5) UI
============================================================================= */
App.UI = (function (app) {
    let _transformPending = false;
    let _dockTransitionTimer = null;

    function bind() {
        app.el.stage = document.getElementById('stage');
        app.el.layer = document.getElementById('layer');
        app.el.workspace = document.querySelector('.workspace');
        app.el.grid = document.getElementById('hexGrid');

        app.el.themeForm = document.getElementById('themeForm');
        app.el.centerBtn = document.getElementById('centerBtn');
        app.el.downloadBtn = document.getElementById('downloadBtn');

        app.el.legendTheme = document.getElementById('legendTheme');

        app.el.infoPanel = document.getElementById('infoPanel');
        app.el.infoText = document.getElementById('infoText');
        app.el.infoCloseBtn = document.getElementById('infoCloseBtn');

        app.el.themeToggleBtn = document.getElementById('themeToggleBtn');

        app.el.dock = document.getElementById('dock');
        app.el.dockHandle = document.getElementById('dockHandle');
        app.el.dockToggleBtn = document.getElementById('dockToggleBtn');

        app.el.themeGroup = document.getElementById('themeGroup');
        app.el.courseGroup = document.getElementById('courseGroup');

        app.el.themeDetails = document.getElementById('themeDetails');
        app.el.courseDetails = document.getElementById('courseDetails');

        app.el.tour = document.getElementById('tour');
        app.el.tourStep = document.getElementById('tourStep');
        app.el.tourText = document.getElementById('tourText');
        app.el.tourPrevBtn = document.getElementById('tourPrevBtn');
        app.el.tourNextBtn = document.getElementById('tourNextBtn');
        app.el.tourCloseBtn = document.getElementById('tourCloseBtn');
        app.el.tourHideBtn = document.getElementById('tourHideBtn');

        app.el.toast = document.getElementById('toast');

        attachTrackTooltips();
        attachBlockTooltips();
        bindThemeToggle();
        bindDockControls();
        bindInfoClose();
        bindLegendModeToggle();

        window.addEventListener('resize', () => {
            updateDockToggleUI();
            updateWorkspaceReserve();
        }, { passive: true });

        [app.el.themeDetails, app.el.courseDetails].forEach((d) => {
            if (!d) return;
            d.addEventListener('toggle', () => updateWorkspaceReserve(), { passive: true });
        });

        updateDockToggleUI();
        updateWorkspaceReserve();
        wireDockSwipe();
    }

    function initCollapsiblesInitialState() {
        [app.el.themeDetails, app.el.courseDetails].forEach((d) => {
            if (!d) return;
            d.open = false;
            d.setAttribute('data-init', '1');
        });
    }

    function attachTrackTooltips() {
        const labelBy = Config.trackLabels || {};
        const scroller = document.querySelector('.dock__content');

        document.querySelectorAll('#legendTracks .legend-item').forEach((item) => {
            const abbrEl = item.querySelector('.abbr');
            if (!abbrEl) return;

            const abbr = (abbrEl.textContent || '').trim();
            const full = labelBy[abbr];
            if (!full) return;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'info-btn';
            btn.setAttribute('aria-label', `Show full name for ${abbr}`);
            btn.innerHTML = '<span class="icon-info" aria-hidden="true">i</span>';

            const tip = document.createElement('div');
            tip.className = 'track-tip';
            tip.textContent = `${full}`;
            tip.setAttribute('role', 'tooltip');
            tip.id = `track-tip-${abbr.toLowerCase()}`;
            btn.setAttribute('aria-describedby', tip.id);

            abbrEl.setAttribute('title', full);

            item.appendChild(btn);
            document.body.appendChild(tip);

            let isOpen = false;

            const adjust = () => {
                if (!isOpen) return;

                const pad = 8;
                const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
                const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);

                const a = btn.getBoundingClientRect();
                let left = a.left;
                let top = a.bottom + 6;

                tip.style.left = `${Math.round(left)}px`;
                tip.style.top = `${Math.round(top)}px`;

                let r = tip.getBoundingClientRect();

                if (r.right > vw - pad) left -= (r.right - (vw - pad));
                if (left < pad) left = pad;

                if (r.bottom > vh - pad) top = a.top - r.height - 6;
                if (top < pad) top = pad;

                tip.style.left = `${Math.round(left)}px`;
                tip.style.top = `${Math.round(top)}px`;
            };

            const show = () => {
                if (isOpen) return;
                tip.classList.add('is-open');
                isOpen = true;
                requestAnimationFrame(adjust);
            };

            const hide = () => {
                if (!isOpen) return;
                tip.classList.remove('is-open');
                isOpen = false;
            };

            const toggle = () => (isOpen ? hide() : show());

            btn.addEventListener('mouseenter', show);
            btn.addEventListener('mouseleave', hide);
            btn.addEventListener('focus', show);
            btn.addEventListener('blur', hide);
            btn.addEventListener('click', toggle);

            item.addEventListener('mouseenter', show);
            item.addEventListener('mouseleave', hide);

            window.addEventListener('resize', () => { if (isOpen) adjust(); }, { passive: true });
            scroller?.addEventListener('scroll', hide, { passive: true });
        });
    }

    /* tooltips for Blocks legend (months) */
    function attachBlockTooltips() {
        const scroller = document.querySelector('.dock__content');
        document.querySelectorAll('#legendBlocks .legend-item').forEach((item, idx) => {
            const abbrEl = item.querySelector('.abbr');
            const btn = item.querySelector('.info-btn');
            if (!abbrEl || !btn) return;

            const label = (abbrEl.textContent || '').trim();       // "1" | "2" | "3" | "4"
            const months = (btn.getAttribute('title') || '').trim(); // "Sept - Oct" etc.

            const tip = document.createElement('div');
            tip.className = 'track-tip';
            tip.textContent = `${months}`;
            tip.setAttribute('role', 'tooltip');
            const tipId = `block-tip-${label}`;
            tip.id = tipId;
            btn.setAttribute('aria-describedby', tipId);

            item.appendChild(btn);
            document.body.appendChild(tip);

            let isOpen = false;
            const adjust = () => {
                if (!isOpen) return;
                const pad = 8;
                const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
                const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
                const a = btn.getBoundingClientRect();
                let left = a.left;
                let top = a.bottom + 6;
                tip.style.left = `${Math.round(left)}px`;
                tip.style.top = `${Math.round(top)}px`;
                let r = tip.getBoundingClientRect();
                if (r.right > vw - pad) left -= (r.right - (vw - pad));
                if (left < pad) left = pad;
                if (r.bottom > vh - pad) top = a.top - r.height - 6;
                if (top < pad) top = pad;
                tip.style.left = `${Math.round(left)}px`;
                tip.style.top = `${Math.round(top)}px`;
            };
            const show = () => { if (!isOpen) { tip.classList.add('is-open'); isOpen = true; requestAnimationFrame(adjust); } };
            const hide = () => { if (isOpen) { tip.classList.remove('is-open'); isOpen = false; } };
            const toggle = () => (isOpen ? hide() : show());

            btn.addEventListener('mouseenter', show);
            btn.addEventListener('mouseleave', hide);
            btn.addEventListener('focus', show);
            btn.addEventListener('blur', hide);
            btn.addEventListener('click', toggle);
            item.addEventListener('mouseenter', show);
            item.addEventListener('mouseleave', hide);
            window.addEventListener('resize', () => { if (isOpen) adjust(); }, { passive: true });
            scroller?.addEventListener('scroll', hide, { passive: true });
        });
    }

    /* Bind Tracks/Blocks mode toggle */
    function bindLegendModeToggle(){
        const tracks = document.getElementById('modeTracks');
        const blocks = document.getElementById('modeBlocks');
        const boxTracks = document.getElementById('legendTracks');
        const boxBlocks = document.getElementById('legendBlocks');
        function apply(mode){
            document.body.setAttribute('data-view-mode', mode);
            const isBlocks = (mode === 'blocks');
            boxTracks.hidden = isBlocks;
            boxBlocks.hidden = !isBlocks;
        }
        tracks?.addEventListener('change', (e)=>{ if (e.target.checked) apply('tracks'); });
        blocks?.addEventListener('change', (e)=>{ if (e.target.checked) apply('blocks'); });
        /* init from body attr (default: tracks) */
        apply(document.body.getAttribute('data-view-mode') || 'tracks');
    }

    function bindThemeToggle() {
        const setText = () => {
            const cur = document.body.getAttribute('data-ui-theme') || 'light';
            const next = (cur === 'dark') ? 'Light theme' : 'Dark theme';
            app.el.themeToggleBtn.textContent = next;
            app.el.themeToggleBtn.setAttribute('aria-label', `Switch to ${next}`);
        };

        app.el.themeToggleBtn.addEventListener('click', () => {
            const cur = document.body.getAttribute('data-ui-theme') || 'light';
            document.body.setAttribute('data-ui-theme', (cur === 'dark') ? 'light' : 'dark');
            setText();
        });

        setText();
    }

    function bindDockControls() {
        app.el.dockToggleBtn.addEventListener('click', async () => {
            if (isDockCollapsed()) {
                if (app.state.focusedId) await App.Flow.deactivate('revealMenu');
                revealDock('user');
            } else {
                collapseDock('user');
            }
        });

        app.el.dockHandle.addEventListener('click', async (e) => {
            if (e.target.closest('#dockToggleBtn')) return;
            if (App._suppressHandleClickOnce) { App._suppressHandleClickOnce = false; return; }

            if (isDockCollapsed()) {
                if (app.state.focusedId) await App.Flow.deactivate('handleRevealMenu');
                revealDock('user');
            } else {
                collapseDock('user');
            }
        });
    }

    function bindInfoClose() {
        app.el.infoCloseBtn.addEventListener('click', () => {
            App.Flow.deactivate('infoClose');
        });
    }

    /* ----- Rendering ---------------------------------------------------------- */
    function renderThemeFilters(themes) {
        const group = app.el.themeGroup;
        if (!group) return;

        group.innerHTML = '';

        const mkId = (s) => 'theme-' + String(s).toLowerCase().replace(/[^\w-]+/g, '-');

        function addChip(value, label, id, extraClass = '') {
            const wrap = document.createElement('label');
            wrap.className = `chip${extraClass ? ' ' + extraClass : ''}`;

            const input = document.createElement('input');
            input.type = 'radio';
            input.name = 'theme';
            input.id = id;
            input.value = value;

            const selected = (value || null) === (app.state.selection.theme || null);
            if (selected) input.checked = true;

            const span = document.createElement('span');
            span.textContent = label;

            wrap.append(input, span);
            group.appendChild(wrap);
        }

        addChip('', 'No theme (show all)', 'theme-none', 'chip--none');
        for (const t of themes) addChip(t.id, t.label, mkId(t.id));

        sizeThemeList();
    }

    function renderCourseSelector(items) {
        const group = app.el.courseGroup;
        if (!group) return;

        group.innerHTML = '';

        for (const v of items) {
            const id = 'course-' + v.id;

            const wrap = document.createElement('label');
            wrap.className = 'check';
            wrap.setAttribute('data-id', v.id);

            const input = document.createElement('input');
            input.type = 'checkbox';
            input.id = id;
            input.name = id;
            input.checked = !app.state.selection.hiddenIds.has(v.id);

            const span = document.createElement('span');
            span.textContent = v.title;

            wrap.append(input, span);
            group.appendChild(wrap);
        }

        sizeCourseList();
    }

    function renderHexGrid(items) {
        const frag = document.createDocumentFragment();
        const hexById = new Map();
        const hexEls = [];

        for (const v of items) {
            const hex = document.createElement('div');
            hex.className = 'hex';
            hex.setAttribute('style', v.style || '');

            // odd-column helper class for correct vertical offset at any q
            if (v._pos?.odd) hex.classList.add('hex--odd');

            hex.setAttribute('data-id', v.id);
            hex.setAttribute('data-track', v._dataset.tracksAttr);
            hex.setAttribute('data-theme', v._dataset.themesAttr);
            hex._themeSet = new Set((v._dataset.themesAttr || '').trim().split(/\s+/).filter(Boolean));
            const b = Array.isArray(v.block) && v.block.length ? String(v.block[0]) : '';
            hex.setAttribute('data-block', b);

            const key = (Array.isArray(v.tracks) ? v.tracks : [])
                .map(s => String(s).toUpperCase())
                .sort()
                .join(' ');
            const symbolId = HEX_SYMBOL_BY_TRACKS[key] || 'hex-all';

            const svgNS = 'http://www.w3.org/2000/svg';
            const svg = document.createElementNS(svgNS, 'svg');
            svg.setAttribute('class', 'hex__svg');
            svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
            svg.setAttribute('width', '100%');
            svg.setAttribute('height', '100%');

            const use = document.createElementNS(svgNS, 'use');
            use.setAttribute('href', `#${symbolId}`);
            // Legacy Safari / embedded WebViews still require xlink:href.
            use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', `#${symbolId}`);
            svg.appendChild(use);

            const label = document.createElement('span');
            label.className = 'hex__label';
            label.textContent = v._label;

            const hit = document.createElement('div');
            hit.className = 'hex__hit';
            hit.setAttribute('tabindex', '0');
            hit.setAttribute('role', 'button');
            hit.setAttribute('aria-label', `Show details for ${v.title}`);

            hex._hit = hit;
            hex.append(svg, label, hit);

            frag.appendChild(hex);
            hexById.set(v.id, hex);
            hexEls.push(hex);
        }

        app.el.grid.innerHTML = '';
        app.el.grid.appendChild(frag);

        app.cache.hexById = hexById;
        app.cache.hexEls = hexEls;
    }

    /* ----- Transform ---------------------------------------------------------- */
    function applyTransform() {
        if (_transformPending) return;
        _transformPending = true;

        cancelAnimationFrame(app.state.rafId);
        app.state.rafId = requestAnimationFrame(() => {
            app.el.layer.style.setProperty('--scale', String(app.state.scale));
            app.el.layer.style.setProperty('--tx', `${app.state.tx}px`);
            app.el.layer.style.setProperty('--ty', `${app.state.ty}px`);
            _transformPending = false;
            updateCenterCTA();
        });
    }

    /* ----- Legend / Info ------------------------------------------------------ */
    function updateLegend(selection) {
        if (app.el.legendTheme) app.el.legendTheme.textContent = selection.theme || '(none)';
    }

    function showInfo(item) {
        const title = Util.escapeHtml(item.title);
        const code = Util.escapeHtml(item.code || '-');
        const tracks = Util.escapeHtml((item.tracks || []).join(', ') || '-');
        const blocks = Util.escapeHtml((item.block || []).join(', ') || '-');
        const description = Util.escapeHtml(item.description || '');

        const html = `
            <strong>${title} (${code})</strong>
            <hr>
            <strong>Track(s):</strong> ${tracks}<br>
            <strong>Block:</strong> ${blocks}<br><br>
            ${description}
        `;

        app.el.infoText.innerHTML = html;
        /* Ensure the info panel starts at the top whenever new content is shown */
        app.el.infoPanel.scrollTop = 0;
        /* Also enforce after paint in case transforms/DOM updates interfere */
        requestAnimationFrame(() => {
            app.el.infoPanel.scrollTop = 0;
        });
        app.el.infoPanel.classList.add('is-open');
    }

    function hideInfo() {
        app.el.infoPanel.classList.remove('is-open');
        /* Reset scroll so the next open starts at the top */
        app.el.infoPanel.scrollTop = 0;
    }

    function updateCenterCTA() {
        const epsS = 0.001, epsT = 1;
        const offScale = Math.abs(app.state.scale - app.state.baseScale) > epsS;
        const offTx = Math.abs(app.state.tx - app.state.baseTx) > epsT;
        const offTy = Math.abs(app.state.ty - app.state.baseTy) > epsT;

        const show = !!(app.state.focusedId || offScale || offTx || offTy || app.state.isDragging || app.state.isPinching);
        app.el.centerBtn.classList.toggle('is-visible', show);
    }

    /* ----- Dock helpers ------------------------------------------------------- */
    function isDockCollapsed() {
        return document.body.classList.contains('dock-collapsed');
    }

    function syncMenuStateFlags() {
        app.state.menu.isCollapsed = isDockCollapsed();
    }

    function afterDockTransition(cb) {
        if (_dockTransitionTimer) {
            clearTimeout(_dockTransitionTimer);
            _dockTransitionTimer = null;
        }

        let called = false;
        const done = () => {
            if (called) return;
            called = true;

            syncMenuStateFlags();
            updateDockToggleUI();
            updateWorkspaceReserve();
            if (typeof cb === 'function') cb();
        };

        const onEnd = (ev) => {
            if (ev.target !== app.el.dock) return;
            app.el.dock.removeEventListener('transitionend', onEnd);
            done();
        };

        app.el.dock.addEventListener('transitionend', onEnd, { once: true });
        _dockTransitionTimer = setTimeout(done, Config.dockTransitionMs + 60);
    }

    function collapseDock(source = 'user') {
        document.body.classList.add('dock-collapsed');
        app.el.dock.setAttribute('aria-hidden', 'true');

        if (source === 'user') {
            app.state.menu.userCollapsed = true;
            app.state.menu.autoCollapsed = false;
        } else if (source === 'auto') {
            app.state.menu.autoCollapsed = true;
        }

        syncMenuStateFlags();
        updateDockToggleUI();
        updateWorkspaceReserve();
        afterDockTransition();
    }

    function revealDock(source = 'user', cb) {
        document.body.classList.remove('dock-collapsed');
        app.el.dock.removeAttribute('aria-hidden');

        if (source === 'user') {
            app.state.menu.userCollapsed = false;
            app.state.menu.autoCollapsed = false;
        } else if (source === 'auto') {
            app.state.menu.autoCollapsed = false;
        }

        syncMenuStateFlags();
        updateDockToggleUI();
        updateWorkspaceReserve();
        afterDockTransition(cb);
    }

    function updateDockToggleUI() {
        const collapsed = isDockCollapsed();
        const landscape = Util.isLandscape();

        let glyph = '▼';
        if (!landscape && collapsed) glyph = '▲';
        if (landscape && !collapsed) glyph = '▶';
        if (landscape && collapsed) glyph = '◀';

        app.el.dockToggleBtn.textContent = glyph;
        app.el.dockToggleBtn.title = collapsed ? 'Show menu' : 'Hide menu';
        app.el.dockToggleBtn.setAttribute('aria-label', collapsed ? 'Show menu' : 'Hide menu');
    }

    function updateWorkspaceReserve() {
        if (!app.el.dock) return;

        const collapsed = isDockCollapsed();
        const landscape = Util.isLandscape();

        const tab = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dock-tab')) || 28;
        const extra = 18;

        if (!landscape) {
            const h = collapsed ? (tab + 12) : app.el.dock.getBoundingClientRect().height;
            document.documentElement.style.setProperty('--dock-reserve-bottom', `${Math.max(tab + 12, Math.round(h + extra))}px`);
            document.documentElement.style.setProperty('--dock-reserve-right', '0px');
        } else {
            const w = collapsed ? (tab + 12) : app.el.dock.getBoundingClientRect().width;
            document.documentElement.style.setProperty('--dock-reserve-right', `${Math.max(tab + 12, Math.round(w + extra))}px`);
            document.documentElement.style.setProperty('--dock-reserve-bottom', '0px');
        }
    }

    function wireDockSwipe() {
        const handle = app.el.dockHandle;
        if (!handle) return;

        let active = false;
        let startX = 0, startY = 0;
        let lastX = 0, lastY = 0;
        let pointerId = null;

        function onDown(e) {
            if (app.state.lockInput) return;
            if (e.pointerType !== 'touch') return;

            active = true;
            pointerId = e.pointerId;
            startX = lastX = e.clientX;
            startY = lastY = e.clientY;

            try { handle.setPointerCapture(pointerId); } catch (_) {}
        }

        function onMove(e) {
            if (!active) return;
            if (e.pointerId !== pointerId) return;

            lastX = e.clientX;
            lastY = e.clientY;

            e.preventDefault();
        }

        async function onUp(e) {
            if (!active) return;
            if (e.pointerId !== pointerId) return;

            active = false;
            try { handle.releasePointerCapture(pointerId); } catch (_) {}

            const dx = lastX - startX;
            const dy = lastY - startY;
            const collapsed = isDockCollapsed();
            const landscape = Util.isLandscape();

            const threshold = Config.dockSwipePx;
            const straightEnough = (a, b) => Math.abs(b) <= Math.max(14, Math.abs(a) * 0.55);

            let swiped = false;

            if (!landscape) {
                if (!collapsed && dy > threshold && straightEnough(dy, dx)) {
                    collapseDock('user'); swiped = true;
                }
                if (collapsed && dy < -threshold && straightEnough(dy, dx)) {
                    if (app.state.focusedId) await App.Flow.deactivate('swipeRevealMenu');
                    revealDock('user'); swiped = true;
                }
            } else {
                if (!collapsed && dx > threshold && straightEnough(dx, dy)) {
                    collapseDock('user'); swiped = true;
                }
                if (collapsed && dx < -threshold && straightEnough(dx, dy)) {
                    if (app.state.focusedId) await App.Flow.deactivate('swipeRevealMenu');
                    revealDock('user'); swiped = true;
                }
            }

            if (swiped) App._suppressHandleClickOnce = true;
        }

        handle.addEventListener('pointerdown', onDown);
        handle.addEventListener('pointermove', onMove, { passive: false });
        handle.addEventListener('pointerup', onUp);
        handle.addEventListener('pointercancel', onUp);
    }

    /* ----- List sizing -------------------------------------------------------- */
    function sizeThemeList() {
        const group = app.el.themeGroup;
        if (!group) return;

        requestAnimationFrame(() => {
            const first = group.querySelector('.chip');
            if (!first) return;

            const r = first.getBoundingClientRect();
            const cs = getComputedStyle(group);
            const gap = parseFloat(cs.rowGap || cs.gap || '8');

            const target = (r.height * 3.8) + (gap * 2.0);
            group.style.maxHeight = `${target}px`;
            group.style.paddingBottom = `${gap * 0.25}px`;
            updateWorkspaceReserve();
        });
    }

    function sizeCourseList() {
        const group = app.el.courseGroup;
        if (!group) return;

        requestAnimationFrame(() => {
            const first = group.querySelector('.check');
            if (!first) return;

            const r = first.getBoundingClientRect();
            const cs = getComputedStyle(group);
            const gap = parseFloat(cs.rowGap || cs.gap || '8');

            const target = (r.height * 4.5) + (gap * 3.5);
            group.style.maxHeight = `${target}px`;
            group.style.paddingBottom = `${gap * 0.25}px`;
            updateWorkspaceReserve();
        });
    }

    /* ----- Intro -------------------------------------------------------------- */
    async function playIntro() {
        const intro = document.getElementById('intro');
        if (!intro) return;
        if (App._introStarted) return;
        App._introStarted = true;
        
        // 1) Wait the minimum delay first
        await Util.wait(Config.introMinDelayMs);
        // 2) Then wait for full load (images, fonts, etc.)
        if (document.readyState !== 'complete') {
            await Promise.race([
                new Promise((resolve) => window.addEventListener('load', resolve, { once: true })),
                Util.wait(2000)
            ]);
        }
        
        const logo = document.getElementById('introLogo');
        if (logo) {
            logo.classList.add('is-hidden');
        }
        
        let killed = false;
        let safetyTimer = null;
        const kill = () => {
            if (killed) return;
            killed = true;
            if (safetyTimer) clearTimeout(safetyTimer);
            try { intro.remove(); } catch (_) {}
        };
        
        // Option A — mask reveal with JS-driven radius (prevents “growing square”)
        const supportsMask =
            (typeof CSS !== 'undefined' && (
                CSS.supports('mask-image', 'radial-gradient(circle at 50% 50%, black 1px, transparent 0)') ||
                CSS.supports('-webkit-mask-image', 'radial-gradient(circle, #000, transparent)')
            ));
            
        if (supportsMask) {
            intro.classList.add('cis-intro--mask');
            // fall through to JS radius animation below
        }
        
        // JS-driven var() animation (used for both mask + gradient fallback)
        // Keeps original "hole reveal" aesthetic using the same radial-gradient.
        const DURATION = 1100;
        const START_DELAY = 120;
        const start = performance.now() + START_DELAY;
        const end = start + DURATION;
        // Safety kill: if masking/RAF behaves unexpectedly on an engine, never leave the overlay up.
        safetyTimer = setTimeout(kill, DURATION + START_DELAY + 300);
        // EaseInOutQuad
        const ease = (t) => (t < 0.5) ? (2 * t * t) : (1 - Math.pow(-2 * t + 2, 2) / 2);
        
        function frame(now) {
            if (killed) return;
            if (now < start) { requestAnimationFrame(frame); return; }
            const p = Math.min(1, (now - start) / (end - start));
            const r = 140 * ease(p); // vmax radius
            intro.style.setProperty('--reveal', r + 'vmax');
            if (p < 1) {
                requestAnimationFrame(frame);
            } else {
                kill();
            }
        }
        requestAnimationFrame(frame);
    }

    return {
        bind,
        initCollapsiblesInitialState,

        renderThemeFilters,
        renderCourseSelector,
        renderHexGrid,

        applyTransform,

        updateLegend,
        showInfo,
        hideInfo,
        updateCenterCTA,

        isDockCollapsed,
        collapseDock,
        revealDock,
        updateWorkspaceReserve,

        sizeThemeList,
        sizeCourseList,

        playIntro
    };
})(App);

/* =============================================================================
    6) Interaction (pan/zoom/tap, filters, resize)
============================================================================= */
App.Interaction = (function (app) {
    const pointers = new Map();
    let startX = 0, startY = 0, startTX = 0, startTY = 0;
    let lastDist = 0;
    let motionTimer = 0;

    let isTap = false;
    let downTarget = null;
    let downX = 0, downY = 0;

    function centerOfStage() {
        const r = app.el.stage.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, rect: r };
    }

    function gridIntrinsicSize() {
        // Prefer layout extents computed on load (stable), converted to px by reading
        // the *primitive* CSS vars (px numbers) and computing derived values in JS.
        // Reason: derived vars like --w/--dx are calc(...) and parseFloat("calc(...)") => NaN.
        const extent = app.cache.layoutExtent;
        const g = app.el.grid;
        
        if (extent && g) {
            const cs = getComputedStyle(g);

            const pxVar = (name, fallback) => {
                const raw = (cs.getPropertyValue(name) || '').trim();
                const n = parseFloat(raw);
                return Number.isFinite(n) ? n : fallback;
            };

            // Primitive vars are declared as px values (parseFloat is safe here)
            const flat = pxVar('--flat', 320);
            const halfH = pxVar('--halfH', 140);
            const hexSpace = pxVar('--hex-space', 24);
            const colGap = pxVar('--col-gap', -105);

            // Mirror CSS geometry:
            // --tri: halfH * 0.606
            // --w: flat + tri*2
            // --h: halfH*2
            // --dx: w*0.75 + colGap
            // --dy: h + hexSpace
            const tri = halfH * 0.606;
            const w = flat + (tri * 2);
            const h = halfH * 2;
            const dx = (w * 0.75) + colGap;
            const dy = h + hexSpace;

            const colSpan = Math.max(0, extent.maxQ - extent.minQ);
            const rowSpan = Math.max(0, extent.maxY - extent.minY);

            return {
                width: Math.max(1, w + dx * colSpan),
                height: Math.max(1, h + dy * rowSpan)
            };
        }
        
        // Fallback (should not be needed in normal runs)
        const w = Math.max(1, g?.offsetWidth || g?.scrollWidth || 1);
        const h = Math.max(1, g?.offsetHeight || g?.scrollHeight || 1);
        return { width: w, height: h };
    }

    function setDims() {
        const w = window.innerWidth;
        const h = window.innerHeight;

        app.state.dim.w = w;
        app.state.dim.h = h;
        app.state.dim.isSmall = w < 600;

        const vw = w / 100;
        const vh = h / 100;
        const s = Math.max(.72, Math.min(1, Math.min(vw * 100, vh * 100) / 900));
        document.documentElement.style.setProperty('--ui-scale', s.toFixed(3));
    }

    function measureBaseFitOnly() {
        setDims();

        const stageRect = app.el.stage.getBoundingClientRect();
        const gridBounds = gridIntrinsicSize();

        const isSmall = app.state.dim.isSmall;
        const pad = Math.max(
            isSmall ? Config.fitPaddingSmall : Config.fitPaddingLarge,
            Math.min(
                isSmall ? 30 : Config.fitPaddingMax,
                Math.round(Math.max(app.state.dim.w, app.state.dim.h) * (isSmall ? 0.01 : 0.02))
            )
        );

        const availW = Math.max(stageRect.width - pad * 2, 1);
        const availH = Math.max(stageRect.height - pad * 2, 1);

        const baseScale = Math.min(availW / gridBounds.width, availH / gridBounds.height) || 1;
        const min = Math.max(0.1, baseScale * 0.25);
        const max = baseScale * 6;

        return { baseScale, min, max, gridBounds };
    }

    function fitAll() {
        const m = measureBaseFitOnly();

        app.state.gridBounds = m.gridBounds;
        app.state.baseScale = m.baseScale;
        app.state.min = m.min;
        app.state.max = m.max;

        app.state.scale = m.baseScale;
        app.state.tx = app.state.baseTx = 0;
        app.state.ty = app.state.baseTy = 0;

        const stageRect = app.el.stage.getBoundingClientRect();
        app.state.infoBiasTy = -Math.min(400, stageRect.height * 0.2);

        App.UI.applyTransform();
    }

    function adoptNewBasePreservingView() {
        const { baseScale: newBase, min: newMin, max: newMax, gridBounds } = measureBaseFitOnly();

        const oldBase = app.state.baseScale || 1;
        const s0 = app.state.scale || 1;
        const tx0 = app.state.tx || 0;
        const ty0 = app.state.ty || 0;

        app.state.baseScale = newBase;
        app.state.min = newMin;
        app.state.max = newMax;
        app.state.gridBounds = gridBounds;

        const s1Wanted = s0 * (newBase / oldBase);
        const s1 = Util.clamp(s1Wanted, app.state.min, app.state.max);
        const r = s0 / s1;

        app.state.scale = s1;
        app.state.tx = tx0 * r;
        app.state.ty = ty0 * r;

        App.UI.applyTransform();
    }

    function applyFilter() {
        const theme = app.state.selection.theme;
        const focusedId = app.state.focusedId;
        const hidden = app.state.selection.hiddenIds;

        app.el.grid.querySelectorAll('.hex').forEach((el) => {
            const id = el.getAttribute('data-id');
            const themesAttr = (el.getAttribute('data-theme') || '').trim();
            const themes = themesAttr ? themesAttr.split(/\s+/) : [];

            const deselectedByCourse = hidden.has(id);
            const mismatchTheme = !!theme && !themes.includes(theme);
            const shouldDim = deselectedByCourse || mismatchTheme;
            
            /* Never fully remove hexes for deselection; just dim them */
            el.classList.remove('hex--hidden');
            el.classList.toggle('hex--dim', shouldDim);

            if (focusedId) {
                el.classList.toggle('hex--subdue',
                    !shouldDim && id !== focusedId);
            } else {
                el.classList.remove('hex--subdue');
            }

            if (id === focusedId) {
                el.classList.remove('hex--dim', 'hex--subdue');
            }
        });

        App.UI.updateLegend(app.state.selection);
        try { updateCourseCount(); } catch(_) {}
    }

    function bumpMoving() {
        if (Config.lightenDuringMotion) document.body.classList.add('is-moving');
        clearTimeout(motionTimer);
        motionTimer = setTimeout(() => document.body.classList.remove('is-moving'), 120);
    }

    function focusById(id) {
        const layer = app.el.layer;
        let measuring = false;
        try {
            layer.classList.add('is-measuring'); // CSS already disables transitions for .is-measuring
            measuring = true;
            const el = app.cache.hexById.get(id);
            if (!el) return;

            const prev = app.el.grid.querySelector('.hex--focus');
            if (prev && prev !== el) prev.classList.remove('hex--focus');

            el.classList.add('hex--focus');
            app.state.focusedId = id;

            const center = centerOfStage();
            const stageRect = center.rect;
            const rect = el.getBoundingClientRect();

            const target = 0.7 * Math.min(stageRect.width, stageRect.height);
            const s0 = app.state.scale;
            const sWanted = target / Math.max(rect.width, rect.height);
            const s1 = Util.clamp(s0 * sWanted, app.state.min, app.state.max);

            const hexCx = rect.left + rect.width / 2;
            const hexCy = rect.top + rect.height / 2;

            const Dx = center.x;
            const Dy = stageRect.top + stageRect.height / 3;

            const T1x = (Dx - center.x) / s1 - (hexCx - center.x) / s0 + app.state.tx;
            const T1y = (Dy - center.y) / s1 - (hexCy - center.y) / s0 + app.state.ty;

            app.state.scale = s1;
            app.state.tx = T1x;
            app.state.ty = T1y;

            App.UI.applyTransform();

            const item = App.cache.courseById.get(id);
            if (item) App.UI.showInfo(item);

            applyFilter();
            App.UI.updateCenterCTA();

            App.Tips?.tipOnFocus?.();

        } finally {
            if (measuring) layer.classList.remove('is-measuring');
        }
        
    }

    function clearFocus() {
        if (app.state.focusedId) {
            const prev = app.cache.hexById.get(app.state.focusedId);
            prev?.classList.remove('hex--focus');
        }
        app.state.focusedId = null;
        App.UI.hideInfo();
        applyFilter();
        App.UI.updateCenterCTA();
    }

    function recenter(opts = {}) {
        const { withInfoBias = false } = opts;

        app.state.scale = app.state.baseScale;
        app.state.tx = app.state.baseTx;
        app.state.ty = withInfoBias ? app.state.infoBiasTy : app.state.baseTy;

        App.UI.applyTransform();
        App.UI.updateCenterCTA();
    }

    function onWheel(e) {
        if (app.state.lockInput) return;

        e.preventDefault();

        const k = e.ctrlKey ? 0.04 : 0.10;
        const f = e.deltaY > 0 ? (1 - k) : (1 + k);

        const center = centerOfStage();
        const s0 = app.state.scale;
        const s1 = Util.clamp(s0 * f, app.state.min, app.state.max);
        const ratio = s1 / s0;

        const cx = e.clientX, cy = e.clientY;

        app.state.tx = (1 - ratio) * (cx - center.x) + ratio * app.state.tx;
        app.state.ty = (1 - ratio) * (cy - center.y) + ratio * app.state.ty;
        app.state.scale = s1;

        App.UI.applyTransform();
        App.UI.updateCenterCTA();

        bumpMoving();
    }

    function dist(a, b) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        return Math.hypot(dx, dy);
    }

    function midpoint(a, b) {
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }

    function onPointerDown(e) {
        if (app.state.lockInput) return;
        if (e.button !== 0) return;

        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        downTarget = e.target || null;
        downX = e.clientX;
        downY = e.clientY;
        isTap = true;

        try { e.target.setPointerCapture(e.pointerId); } catch (_) {}

        if (pointers.size === 1) {
            app.state.isDragging = false;
            startX = e.clientX;
            startY = e.clientY;
            startTX = app.state.tx;
            startTY = app.state.ty;
        } else if (pointers.size === 2) {
            app.state.isPinching = true;
            isTap = false;

            const [a, b] = [...pointers.values()];
            lastDist = dist(a, b);
            bumpMoving();
        }
    }

    function onPointerMove(e) {
        if (!pointers.has(e.pointerId)) return;
        if (app.state.lockInput) return;

        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (app.state.isPinching && pointers.size >= 2) {
            const [a, b] = [...pointers.values()];
            const d = dist(a, b);

            if (d > 0 && lastDist > 0) {
                const m = midpoint(a, b);
                const center = centerOfStage();

                const s0 = app.state.scale;
                const s1 = Util.clamp(s0 * (d / lastDist), app.state.min, app.state.max);
                const r = s1 / s0;

                app.state.tx = (1 - r) * (m.x - center.x) + r * app.state.tx;
                app.state.ty = (1 - r) * (m.y - center.y) + r * app.state.ty;
                app.state.scale = s1;

                App.UI.applyTransform();
                lastDist = d;

                bumpMoving();
            }
        } else if (pointers.size === 1) {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            const moved = Math.hypot(dx, dy) > 4;

            if (moved) isTap = false;

            if (!app.state.isDragging && moved) {
                app.state.isDragging = true;
                document.body.classList.add('is-dragging');
                if (Config.lightenDuringMotion) document.body.classList.add('is-moving');
            }

            if (app.state.isDragging) {
                app.state.tx = startTX + dx;
                app.state.ty = startTY + dy;
                App.UI.applyTransform();
            }
        }

        App.UI.updateCenterCTA();
    }

    function onPointerUp(e) {
        if (!pointers.has(e.pointerId)) return;

        pointers.delete(e.pointerId);

        try { e.target.releasePointerCapture(e.pointerId); } catch (_) {}

        if (pointers.size === 0) {
            if (isTap && !app.state.lockInput) {
                const moved = Math.hypot(e.clientX - downX, e.clientY - downY) > 6;
                const hexHit = !moved && downTarget && downTarget.closest ? downTarget.closest('.hex__hit') : null;
                const hexEl = hexHit ? hexHit.closest('.hex') : null;
                const id = hexEl?.getAttribute('data-id');

                if (id) {
                    if (app.state.focusedId === id) App.Flow.deactivate('activeHexClick');
                    else App.Flow.activate(id);
                } else {
                    App.Flow.deactivate('emptyTap');
                }
            }

            app.state.isDragging = false;
            app.state.isPinching = false;

            isTap = false;
            downTarget = null;

            document.body.classList.remove('is-dragging');
            if (Config.lightenDuringMotion) document.body.classList.remove('is-moving');
        } else if (pointers.size === 1) {
            app.state.isPinching = false;

            const p = [...pointers.values()][0];
            startX = p.x;
            startY = p.y;
            startTX = app.state.tx;
            startTY = app.state.ty;
        }

        App.UI.updateCenterCTA();
    }

    function onKeydown(e) {
        if (app.state.lockInput) return;

        if ((e.key === 'Enter' || e.key === ' ') && document.activeElement?.classList?.contains('hex__hit')) {
            e.preventDefault();
            const hex = document.activeElement.closest('.hex');
            const id = hex?.getAttribute('data-id');
            if (!id) return;

            if (app.state.focusedId === id) App.Flow.deactivate('keyboardToggleOff');
            else App.Flow.activate(id);
        }

        if (e.key === 'Escape') {
            if (app.state.focusedId) App.Flow.deactivate('esc');
        }
    }

    function bindFiltersDelegated() {
        app.el.themeGroup.addEventListener('change', async (e) => {
            const target = e.target;
            if (!(target instanceof HTMLInputElement)) return;
            if (target.type !== 'radio' || target.name !== 'theme') return;
            if (!target.checked) return;

            const v = (target.value || '').trim();
            app.state.selection.theme = v || null;

            if (v) {
                const newHidden = new Set();
                for (const c of App.Domain.all()) {
                    const hasTheme = (c.themes || []).map(String).includes(v);
                    if (!hasTheme) newHidden.add(c.id);
                }
                app.state.selection.hiddenIds = newHidden;
            } else {
                /* No theme → select them all */
                app.state.selection.hiddenIds.clear();
            }
            
            /* Reflect in the checkbox list */
            try { syncCourseCheckboxesToHiddenSet(); } catch(_) {}

            await App.Flow.deactivate('themeChange');
            applyFilter();

            if (v) App.Tips.tipOnFilter();
        });

        /* Helper: any manual course selection should override/clear an active theme filter */
        function forceNoThemeAndReflectUI(){
            if (app.state.selection.theme) {
                app.state.selection.theme = null;
                const noneRadio = document.querySelector('#themeGroup input[name="theme"][value=""]');
                if (noneRadio) noneRadio.checked = true;
                App.UI.updateLegend(app.state.selection);
            }
        }

        app.el.courseGroup.addEventListener('change', async (e) => {
            const target = e.target;
            if (!(target instanceof HTMLInputElement)) return;
            if (target.type !== 'checkbox') return;

            const wrap = target.closest('.check');
            const id = wrap?.getAttribute('data-id');
            if (!id) return;

            if (target.checked) app.state.selection.hiddenIds.delete(id);
            else app.state.selection.hiddenIds.add(id);

            forceNoThemeAndReflectUI();

            if (!target.checked && app.state.focusedId === id) {
                await App.Flow.deactivate('courseHidden');
            }

            applyFilter();
            try { updateCourseCount(); } catch(_) {}
        });
    }

    function bindCourseBulkActions() {
        const selectAllBtn = document.getElementById('coursesAllBtn');
        const selectNoneBtn = document.getElementById('coursesNoneBtn');

        function setAll(checked) {
            if (app.state.selection.theme) {
                app.state.selection.theme = null;
                const noneRadio = document.querySelector('#themeGroup input[name="theme"][value=""]');
                if (noneRadio) noneRadio.checked = true;
                App.UI.updateLegend(app.state.selection);
            }
            
            const boxes = [...app.el.courseGroup.querySelectorAll('input[type="checkbox"]')];
            for (const b of boxes) {
                const wrap = b.closest('.check');
                const id = wrap?.getAttribute('data-id');
                if (!id) continue;

                b.checked = checked;
                if (checked) app.state.selection.hiddenIds.delete(id);
                else app.state.selection.hiddenIds.add(id);
            }
            applyFilter();
            try { updateCourseCount(); } catch(_) {}
        }

        selectAllBtn?.addEventListener('click', () => setAll(true));
        selectNoneBtn?.addEventListener('click', () => setAll(false));
    }

    function attach() {
        app.el.layer.addEventListener('wheel', onWheel, { passive: false });

        app.el.layer.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('pointermove', onPointerMove, { passive: true });
        document.addEventListener('pointerup', onPointerUp, { passive: true });
        document.addEventListener('pointercancel', onPointerUp, { passive: true });

        app.el.layer.addEventListener('gesturestart', (e) => e.preventDefault());
        document.addEventListener('keydown', onKeydown);

        app.el.centerBtn.addEventListener('click', async () => {
            if (app.state.focusedId) await App.Flow.deactivate('centerBtn');
            else recenter();
        });

        app.el.downloadBtn.addEventListener('click', (e) => {
            e.preventDefault();
            App.Export.run();
        });

        bindFiltersDelegated();
        bindCourseBulkActions();
    }

    /* (x / total) counter helpers */
    function updateCourseCount() {
        const total = App.Domain.all().length;
        const checked = [...app.el.courseGroup.querySelectorAll('input[type="checkbox"]')].filter(cb => cb.checked).length;
        const el = document.getElementById('courseCount');
        if (el) el.textContent = `(${checked} / ${total})`;
    }
    
    function syncCourseCheckboxesToHiddenSet() {
        const boxes = [...app.el.courseGroup.querySelectorAll('input[type="checkbox"]')];
        for (const b of boxes) {
            const id = b.closest('.check')?.getAttribute('data-id');
            if (!id) continue;
            b.checked = !App.state.selection.hiddenIds.has(id);
        }
        updateCourseCount();
    }

    let _resizeTimer = null;
    function onResize() {
        clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(() => {
            adoptNewBasePreservingView();

            try {
                App.UI.sizeThemeList();
                App.UI.sizeCourseList();
                App.UI.updateWorkspaceReserve();
            } catch (_) {}

            if (app.state.focusedId) {
                const id = app.state.focusedId;
                requestAnimationFrame(() => focusById(id));
            } else {
                App.UI.updateCenterCTA();
            }
        }, 120);
    }

    return {
        attach,
        applyFilter,
        fitAll,
        onResize,
        clearFocus,
        recenter,
        focusById,
        adoptNewBasePreservingView
    };
})(App);

/* =============================================================================
    7) Flow (sequenced activate/deactivate)
============================================================================= */
App.Flow = (function (app) {
    const q = [];
    let running = false;

    function lockInput(v) {
        app.state.lockInput = !!v;
    }

    /**
        * Wait for the dock AND the workspace padding transition to finish,
        * so stage size is final before we measure/zoom to a hex.
        */
    async function waitDockAndWorkspace() {
        const waits = [];
        // Dock slide
        waits.push(waitTransition(app.el.dock, Config.dockTransitionMs + 80));
        // Workspace padding animates when the dock opens/closes
        if (app.el.workspace) {
            waits.push(waitTransition(app.el.workspace, Config.dockTransitionMs + 120));
        }
        await Promise.all(waits);
        await Util.nextFrame(2); // ensure layout has settled
    }

    async function ensureStableStageForFocus() {
        // Always go through the same flow so both cases behave identically.
        const wasVisible = !App.UI.isDockCollapsed();
        if (wasVisible) App.UI.collapseDock('auto');

        // Wait for dock & workspace to fully settle (even if it was already hidden,
        // this ensures we don’t race any in-flight transitions).
        await waitDockAndWorkspace();

        // Recompute baseScale/min/max against the *final* stage rect.
        app.Interaction.adoptNewBasePreservingView();

        // Give ResizeObserver/visualViewport a moment to flush and the DOM to settle.
        await Util.nextFrame(2);
    }

    function waitTransition(el, maxMs = 350) {
        return new Promise((resolve) => {
            let done = false;

            const timer = setTimeout(() => {
                if (done) return;
                done = true;
                resolve();
            }, Math.max(0, maxMs));

            const onEnd = (e) => {
                if (e.target !== el) return;
                el.removeEventListener('transitionend', onEnd);

                if (done) return;
                done = true;
                clearTimeout(timer);
                resolve();
            };

            el.addEventListener('transitionend', onEnd, { once: true });
        });
    }

    function enqueue(fn) {
        return new Promise((resolve, reject) => {
            q.push({ fn, resolve, reject });
            drain();
        });
    }

    async function drain() {
        if (running) return;
        const item = q.shift();
        if (!item) return;

        running = true;
        lockInput(true);

        try {
            const r = await item.fn();
            item.resolve(r);
        } catch (e) {
            console.error(e);
            item.reject(e);
        } finally {
            lockInput(false);
            running = false;
            if (q.length) drain();
        }
    }

    async function initialFit() {
        app.Interaction?.applyFilter?.();
        app.Interaction?.fitAll?.();
        await Util.nextFrame(2);
    }

    async function activate(id) {
        return enqueue(async () => {
            await ensureStableStageForFocus();
            app.Interaction.focusById(id);
            await waitTransition(app.el.layer, Config.layerTransitionMs + 60);
        });
    }


    async function deactivate(reason = '') {
        return enqueue(async () => {
            const menuVisible = !App.UI.isDockCollapsed();
            const wasAutoCollapsed = !!app.state.menu.autoCollapsed;

            App.UI.hideInfo();
            app.Interaction.clearFocus();

            app.Interaction.recenter({ withInfoBias: false });
            await waitTransition(app.el.layer, Config.layerTransitionMs + 60);
            await Util.wait(Config.menuHexDelayMs);

            if (!menuVisible && wasAutoCollapsed && !app.state.menu.userCollapsed) {
                App.UI.revealDock('auto');
                await waitTransition(app.el.dock, Config.dockTransitionMs + 80);
            }
        });
    }

    return {
        initialFit,
        activate,
        deactivate,
        isBusy: () => running
    };
})(App);

/* =============================================================================
    7.5) Actions — global reset from title
============================================================================= */
App.Actions = (function (app) {
    async function resetAll(source = 'title') {
        if (app.state.focusedId) {
            await App.Flow.deactivate('resetAll');
        } else {
            App.UI.hideInfo();
        }

        app.state.selection.theme = null;
        app.state.selection.hiddenIds.clear();

        const noneRadio = document.querySelector('#themeGroup input[name="theme"][value=""]');
        if (noneRadio) noneRadio.checked = true;

        document.querySelectorAll('#courseGroup .check input[type="checkbox"]').forEach(cb => {
            cb.checked = true;
        });

        App.Interaction.applyFilter();
        App.Interaction.fitAll();
        App.UI.revealDock('user');
        App.UI.updateCenterCTA();
    }

    function bindTitle() {
        const t = document.querySelector('.app-title');
        if (!t) return;

        t.addEventListener('click', () => { if (!App.Flow.isBusy()) resetAll('click'); });
        t.addEventListener('keydown', (e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !App.Flow.isBusy()) {
                e.preventDefault();
                resetAll('key');
            }
        });
    }

    return { resetAll, bindTitle };
})(App);

/* =============================================================================
8) Export — as PNG (html-to-image external tool)
============================================================================ */
App.Export = (function (app) {
async function run() {
    const stage = app?.el?.stage || document.querySelector('.stage');
    const grid  = app?.el?.grid  || document.querySelector('.hex-grid');
    if (!stage || !grid) return;

    const restore = hideChrome();
    try {
    // A4 landscape, viewport-independent
    const W = 4800, H = Math.round(W / Math.SQRT2);
    const OUT = createCanvas(W, H), ctx = OUT.ctx;

    // Layout
    const Mx = 72, My = 60;
    const innerW = W - 2 * Mx, innerH = H - 2 * My;
    const titleH = Math.floor(innerH * 0.09);
    const midH   = Math.floor(innerH * 0.76);
    const footH  = innerH - titleH - midH;
    const left   = Mx, top = My, titleY = top, midY = top + titleH, footY = midY + midH;
    const inset = 24;
    const contX = left + inset, contW = innerW - 2 * inset;
    const contY = midY  + inset, contH = (midH + footH) - 2 * inset;
    fill(ctx, 0, 0, W, H, css('--surface', '#fff'));
    fill(ctx, contX, contY, contW, contH, css('--surface-2', '#e3e3e3'));

    // Row 1 in PNG
    const titlePx = Math.floor(titleH * 0.70);
    await drawTitleBar(ctx, left, titleY, innerW, titleH, titlePx);

    const st = stage.getBoundingClientRect();
    const allHex = Array.from(grid.querySelectorAll('.hex'))
        .filter(n => getComputedStyle(n).display !== 'none');
    const rs  = (allHex.length ? allHex : [grid]).map(n => n.getBoundingClientRect());
    let L=+Infinity,T=+Infinity,R=-Infinity,B=-Infinity;
    for (const r of rs) { L=Math.min(L,r.left); T=Math.min(T,r.top); R=Math.max(R,r.right); B=Math.max(B,r.bottom); }

    let cx = L - st.left, cy = T - st.top, cw = Math.max(1, R-L), ch = Math.max(1, B-T);
    const pad = Math.round(Math.max(cw, ch) * 0.08);
    cx = Math.max(0, cx - pad); cy = Math.max(0, cy - pad);
    cw = Math.min(st.width  - cx, cw + pad*2);
    ch = Math.min(st.height - cy, ch + pad*2);

    // Row 2 in PNG
    const row2Top = contY, row2H = Math.floor(midH - inset);
    const fit     = Math.min(contW / cw, row2H / ch);
    const pr      = Math.max(2, fit * 1.6);

    const snapshot = await htmlToImage.toPng(stage, {
        pixelRatio: pr,
        backgroundColor: css('--surface-2', '#e3e3e3'),
        cacheBust: true
    });

    const sx = Math.round(cx * pr), sy = Math.round(cy * pr);
    const sw = Math.round(cw * pr), sh = Math.round(ch * pr);
    const dw = Math.round(cw * fit), dh = Math.round(ch * fit);
    const dx = contX + Math.floor((contW - dw) / 2);
    const dy = row2Top + Math.floor((row2H - dh) / 2);

    const img = await loadImg(snapshot);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);

    stroke(ctx, contX, contY, contW, contH, css('--title', '#003366'), 4);

    // Row 3 in PNG
    const legend = collectLegendData(app, grid);
    const basePx = Math.max(14, Math.floor(titlePx * 0.34));
    const cardMarginSides = Math.max(28, Math.floor(footH * 0.10));
    const cardX = contX + cardMarginSides;
    const cardY = footY;
    const cardW = contW - cardMarginSides * 2;
    const cardH = contY + contH - cardY - cardMarginSides;
    drawLegendCardCentered(ctx, cardX, cardY, cardW, cardH, legend, basePx);

    // Download
    triggerDownload(OUT.canvas.toDataURL('image/png'), 'CIS-overview.png');
    } finally { restore(); }
}

// ---------- Legend data rules ----------
function collectLegendData(app, grid) {
    const mode = (document.body.getAttribute('data-view-mode') || 'tracks').toLowerCase();
    const rawTheme = (app?.state?.selection?.theme || '').toString().trim();
    const theme = rawTheme && rawTheme.toLowerCase() !== 'all' ? rawTheme : '(none)';
    const tiles = Array.from(grid.querySelectorAll('.hex'));
    const total = tiles.length;
    const visible = tiles.filter(el => !el.classList.contains('hex--dim')).length || total;
    if (mode === 'blocks') {
    return {
        heading: 'Blocks', theme, visible, total,
        chips: [
        { label: 'Block 1', color: css('--track-bdm', '#008fc7') },
        { label: 'Block 2', color: css('--track-cc',  '#3c7a47') },
        { label: 'Block 3', color: css('--track-nmd', '#ab833f') },
        { label: 'Block 4', color: css('--track-extra', '#d22f2f') }
        ]
    };
    }
    return {
    heading: 'Tracks', theme, visible, total,
    chips: [
        { label: 'BDM', color: css('--track-bdm', '#008fc7') },
        { label: 'CC',  color: css('--track-cc',  '#3c7a47') },
        { label: 'NMD', color: css('--track-nmd', '#ab833f') }
    ]
    };
}

// ---------- Title bar with Tilburg University logo & stamp ----------
async function drawTitleBar(ctx, x, y, w, h, px) {
    const inset = Math.floor(h * .20);
    const centerY = y + Math.floor(h / 2);

    // Logo
    const logoSize = Math.floor(h * 0.75);
    await drawSvgById(ctx, 'Tiu-logo', x + inset, centerY - Math.floor(logoSize/2), logoSize, logoSize);

    // Title
    ctx.fillStyle = css('--title', '#003366');
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${px}px system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif`;
    const titleX = x + inset + logoSize + Math.floor(logoSize * 0.4);
    ctx.fillText('CIS Overview', titleX, centerY);

    // Stamp
    ctx.font = `500 ${Math.floor(px * .34)}px system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif`;
    ctx.fillStyle = css('--text-weak','rgba(0,0,0,.72)');
    ctx.textAlign = 'right';
    ctx.fillText(`Exported at: ${new Date().toLocaleString()}`, x + w - inset, y + Math.floor(h * .35));
    ctx.textAlign = 'start';
}

async function drawSvgById(ctx, id, x, y, w, h) {
    const src = document.getElementById(id);
    if (!src) return;
    const clone = src.cloneNode(true);
    inlineSvgPaint(src, clone);
    if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(w));
    clone.setAttribute('height', String(h));
    const svgText = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([svgText], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    try {
        const img = await loadImg(url);
        ctx.drawImage(img, x, y, w, h);
    } finally {
        URL.revokeObjectURL(url);
    }
}

function inlineSvgPaint(srcRoot, dstRoot) {
    const sWalker = document.createTreeWalker(srcRoot, NodeFilter.SHOW_ELEMENT);
    const dWalker = document.createTreeWalker(dstRoot, NodeFilter.SHOW_ELEMENT);
    while (sWalker.nextNode() && dWalker.nextNode()) {
        const sEl = sWalker.currentNode;
        const dEl = dWalker.currentNode;
        const cs = getComputedStyle(sEl);
        const fill = cs.fill;
        const stroke = cs.stroke;
        if (fill && fill !== 'none') dEl.setAttribute('fill', fill);
        if (stroke && stroke !== 'none') dEl.setAttribute('stroke', stroke);
    }
}

// ---------- Legend card ----------
function drawLegendCardCentered(ctx, x, y, w, h, data, basePx) {
    // Card
    roundRect(ctx, x, y, w, h, Math.max(12, Math.floor(h*.08)), css('--surface','#fff'), css('--border-strong','rgba(0,0,0,.14)'));

    // Base metrics
    const pad = Math.max(24, Math.floor(basePx * 1.2));
    const colGap = Math.max(pad, Math.floor(w * .04));
    const colW = Math.floor((w - 2*pad - colGap) / 2);
    const fsHead = Math.floor(basePx * 1.2);
    const fsLbl  = Math.floor(basePx * 1.2);
    const chipSz = Math.floor(basePx * .95);
    const gapA   = Math.floor(basePx * 1.4);  // heading->chips
    const gapB   = Math.floor(basePx * 0.6);  // theme->courses

    const leftBlockH  = fsHead + gapA + chipSz;
    const rightBlockH = fsLbl + gapB + fsLbl;
    const blockH = Math.max(leftBlockH, rightBlockH);
    const vy = y + Math.floor((h - blockH) / 2);

    let cx = x + pad, cy = vy;
    ctx.fillStyle = css('--title', '#003366');
    ctx.font = `800 ${fsHead}px system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif`;
    ctx.fillText(data.heading, cx, cy + fsHead);        // baseline draw
    const chipsTop = cy + fsHead + gapA + Math.floor(chipSz * 0.75);
    drawChipsRow(ctx, cx, chipsTop, data.chips, chipSz);

    cx = x + pad + colW + colGap; cy = vy;
    const txt = css('--text', '#0d0e0e');
    const titleC = css('--title', '#003366');
    ctx.fillStyle = titleC;
    ctx.font = `800 ${fsLbl}px system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif`;
    ctx.fillText('Theme', cx, cy + fsLbl);
    ctx.fillStyle = txt;
    ctx.font = `${fsLbl}px system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif`;
    ctx.fillText(String(data.theme), cx + Math.floor(colW * 0.35), cy + fsLbl);

    ctx.fillStyle = titleC;
    ctx.font = `800 ${fsLbl}px system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif`;
    const cy2 = cy + fsLbl + gapB;
    ctx.fillText('Courses', cx, cy2 + fsLbl);
    ctx.fillStyle = txt;
    ctx.font = `${fsLbl}px system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif`;
    ctx.fillText(`${data.visible} / ${data.total}`, cx + Math.floor(colW * 0.35), cy2 + fsLbl);
}

function drawChipsRow(ctx, x, yBaseline, chips, size) {
    const sq = Math.max(10, Math.floor(size));
    const sp1 = ctx.measureText(' ').width;
    const sp4 = ctx.measureText('    ').width;
    let cx = x;
    for (const c of chips) {
    const top = yBaseline - Math.floor(sq * 0.75);
    fill(ctx, cx, top, sq, sq, c.color);
    cx += sq + sp1;

    ctx.fillStyle = css('--text', '#0d0e0e');
    ctx.font = `${size}px system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(c.label, cx, yBaseline);
    cx += ctx.measureText(c.label).width + sp4;
    }
}

// ----- micro-utils -----
function hideChrome() {
    const undo = [];
    for (const s of ['.dock','.tour','.toast','.btn--center','.info','.btn--close-overview','.app-title']) {
    const el = document.querySelector(s); if (!el) continue;
    const d = el.style.display; el.style.display='none'; undo.push(()=>el.style.display=d);
    }
    return () => undo.reverse().forEach(f=>f());
}
function createCanvas(w,h){ const c=document.createElement('canvas'); c.width=w; c.height=h; return {canvas:c,ctx:c.getContext('2d')}; }
function fill(ctx,x,y,w,h,color){ ctx.save(); ctx.fillStyle=color; ctx.fillRect(x,y,w,h); ctx.restore(); }
function stroke(ctx,x,y,w,h,color,px){ ctx.save(); ctx.strokeStyle=color; ctx.lineWidth=px||1; ctx.strokeRect(x,y,w,h); ctx.restore(); }
function roundRect(ctx,x,y,w,h,r,fillCol,strokeCol){
    const rr=Math.max(0,Math.min(r,Math.min(w,h)/2)); ctx.beginPath();
    ctx.moveTo(x+rr,y); ctx.arcTo(x+w,y,x+w,y+h,rr); ctx.arcTo(x+w,y+h,x,y+h,rr);
    ctx.arcTo(x,y+h,x,y,rr); ctx.arcTo(x,y,x+w,y,rr); ctx.closePath();
    if(fillCol){ctx.fillStyle=fillCol;ctx.fill();} if(strokeCol){ctx.strokeStyle=strokeCol;ctx.lineWidth=1;ctx.stroke();}
}
function css(name,fallback){ return getComputedStyle(document.body).getPropertyValue(name).trim() || fallback; }
function loadImg(url){ return new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=rej; i.src=url; }); }
function triggerDownload(dataUrl, filename){ const a=document.createElement('a'); a.href=dataUrl; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); }

return { run };
})(App);

/* =============================================================================
    9) Tips (driven by tipsData JSON; step count x/total; preserves order)
============================================================================= */
App.Tips = (function (app) {
    const LS_HIDE = 'cis.tips.hidden';
    const LS_SEEN_FOCUS = 'cis.tips.seen.focus';
    const LS_SEEN_FILTER = 'cis.tips.seen.filter';

    function loadTips() {
        try {
            const parsed = Array.isArray(window.__CIS_TIPS__)
                ? window.__CIS_TIPS__
                : JSON.parse(document.getElementById('tipsData')?.textContent || '[]');
            const arr = Array.isArray(parsed) ? parsed : [];
            return arr.map((it) => {
                if (typeof it === 'string') return { t: it };
                if (it && typeof it === 'object') {
                    if (typeof it.t === 'string') return { t: it.t };
                    if (typeof it.text === 'string') return { t: it.text };
                }
                return null;
            }).filter(Boolean);
        } catch (_) {
            return [];
        }
    }
    let STEPS = null;
    function getSteps() {
        if (!STEPS || !STEPS.length) STEPS = loadTips();
        return STEPS;
    }

    let cur = 0;

    function applyStep() {
        const steps = getSteps();
        const total = steps.length;
        if (!app.el.tour) return;
        if (!total) { close(); return; }

        app.el.tourStep.textContent = `${cur + 1}/${total}`;
        app.el.tourText.textContent = steps[cur].t;
        app.el.tour.classList.add('is-open');

        // Button enable/disable
        app.el.tourPrevBtn.disabled = (cur === 0);
        app.el.tourNextBtn.disabled = (cur === total - 1);
        
        // Button styles per step:
        // 1/3: Back=btn, Next=btn--ghost, Close=btn
        // 2/3: Back=btn--ghost, Next=btn--ghost, Close=btn
        // 3/3: Back=btn--ghost, Next=btn, Close=btn--ghost
        const backBtn  = app.el.tourPrevBtn;
        const nextBtn  = app.el.tourNextBtn;
        const closeBtn = app.el.tourCloseBtn;
        
        // reset to base
        backBtn.className  = 'btn';
        nextBtn.className  = 'btn';
        
        if (cur === 0) {
            nextBtn.classList.add('btn--ghost');
        } else if (cur === 1) {
            backBtn.classList.add('btn--ghost');
            nextBtn.classList.add('btn--ghost');
        } else {
            backBtn.classList.add('btn--ghost');
        }
    }

    function close() {
        if (!app.el.tour) return;
        app.el.tour.classList.remove('is-open');
    }

    function showIfAllowed() {
        try {
            if (localStorage.getItem(LS_HIDE) === '1') return;
        } catch (_) {}

        const steps = getSteps();
        if (!steps.length) return;
        cur = 0;
        applyStep();
    }

    function toast(msg, ttl = 3800) {
        const t = app.el.toast;
        if (!t) return;

        t.textContent = msg;
        t.classList.add('is-open');
        setTimeout(() => t.classList.remove('is-open'), ttl);
    }

    function tipOnFocus() {
        try {
            if (localStorage.getItem(LS_SEEN_FOCUS) === '1') return;
            localStorage.setItem(LS_SEEN_FOCUS, '1');
        } catch (_) {}

        toast('Details appear in the panel at the bottom.', 4200);
    }

    function tipOnFilter() {
        try {
            if (localStorage.getItem(LS_SEEN_FILTER) === '1') return;
            localStorage.setItem(LS_SEEN_FILTER, '1');
        } catch (_) {}

        toast('Tip: click “No theme” to show all courses again.', 4200);
    }

    function bind() {
        if (!app.el.tour) return;

        app.el.tourPrevBtn.addEventListener('click', () => { if (cur > 0) { cur--; applyStep(); } });
        app.el.tourNextBtn.addEventListener('click', () => {
            const total = STEPS.length;
            if (cur < total - 1) { cur++; applyStep(); }
        });
        app.el.tourCloseBtn.addEventListener('click', close);

        app.el.tourHideBtn.addEventListener('click', () => {
            try { localStorage.setItem(LS_HIDE, '1'); } catch (_) {}
            close();
        });

        // Keep current step but refresh DOM if viewport changes
        window.addEventListener('resize', () => { if (app.el.tour.classList.contains('is-open')) applyStep(); }, { passive: true });
    }

    return { bind, showIfAllowed, tipOnFocus, tipOnFilter };
})(App);

/* =============================================================================
    10) Bootstrap
============================================================================= */

/* Force Tracks view at the earliest possible moments (fresh load + BFCache restore).
This prevents browser state restoration from re-checking the “Blocks” radio and
leaving the UI in blocks mode. */
function forceTracksOnBoot() {
    try {
        document.body.setAttribute('data-view-mode', 'tracks');
        const tracks = document.getElementById('modeTracks');
        const blocks = document.getElementById('modeBlocks');
        if (tracks) tracks.checked = true;
        if (blocks) blocks.checked = false;
        const boxTracks = document.getElementById('legendTracks');
        const boxBlocks = document.getElementById('legendBlocks');
        if (boxTracks) boxTracks.hidden = false;
        if (boxBlocks) boxBlocks.hidden = true;
    } catch(_) {}
}

/* Handle page restore from the back/forward cache (“soft refresh”). */
window.addEventListener('pageshow', () => {
    forceTracksOnBoot();
}, { passive: true });

async function start() {
    forceTracksOnBoot();
    /* Regular build: if CIS_DATA_URLS is provided by index.html, prefetch JSON once
       and stash it on globals for the existing loaders to pick up. */
    if (window.CIS_DATA_URLS) {
        try {
            const u = window.CIS_DATA_URLS;
            const [courses, themes, overview, tips] = await Promise.all([
                fetch(u.courses).then(r => r.json()),
                fetch(u.themes).then(r => r.json()),
                fetch(u.overview).then(r => r.json()),
                fetch(u.tips).then(r => r.json())
            ]);
            window.__CIS_COURSES__  = Array.isArray(courses)  ? courses  : [];
            window.__CIS_THEMES__   = Array.isArray(themes)   ? themes   : [];
            window.__CIS_OVERVIEW__ = (overview && typeof overview === 'object') ? overview : {};
            window.__CIS_TIPS__     = Array.isArray(tips)     ? tips     : [];
        } catch (e) {
            console.warn('[CIS] Failed to fetch external JSON; falling back to inline data.', e);
        }
    }

    App.Domain.load();
    App.Themes.load();

    App.UI.bind();

    App.state.selection = {
        theme: Config.defaultTheme,
        hiddenIds: new Set()
    };

    App.UI.renderThemeFilters(App.Themes.all());
    App.UI.renderCourseSelector(App.Domain.all());
    App.UI.renderHexGrid(App.Domain.all());
    try { document.getElementById('courseCount').textContent = `(${App.Domain.all().length} / ${App.Domain.all().length})`; } catch(_) {}

    App.UI.initCollapsiblesInitialState();

    App.Interaction.attach();

    App.Tips.bind();
    App.Tips.showIfAllowed();
    App.Actions.bindTitle();

    await App.Flow.initialFit();
    App.UI.playIntro();

    window.addEventListener('resize', App.Interaction.onResize, { passive: true });

    if ('visualViewport' in window && window.visualViewport) {
        window.visualViewport.addEventListener('resize', App.Interaction.onResize, { passive: true });
    }

    try {
        const ro = new ResizeObserver(() => App.Interaction.onResize());
        ro.observe(document.getElementById('stage'));
        App._resizeObserver = ro;
    } catch (_) {}

    requestAnimationFrame(() => {
        try {
            App.UI.sizeThemeList();
            App.UI.sizeCourseList();
            App.UI.updateWorkspaceReserve();
        } catch (_) {}
    });
}

window.addEventListener('DOMContentLoaded', start, { once: true });