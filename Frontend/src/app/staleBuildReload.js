/**
 * Make a stale shell heal itself.
 *
 * Chunk filenames are content-hashed, so a browser that cached index.html
 * before a deploy keeps loading the previous build's chunks. Old chunks are
 * kept for a while (emptyOutDir:false) precisely so those sessions can finish
 * -- but that also meant a stale tab could run old code indefinitely, and once
 * the prune script removes retired chunks, it would start failing instead.
 *
 * Two detectors, one action, taken at most once per build:
 *
 *  1. Version poll: /version.json carries the server's current build id, and
 *     __BUILD_ID__ is the id baked into this bundle. Checked when the tab
 *     regains focus and on a slow interval -- the moments a long-lived tab
 *     comes back to life are exactly when it is most likely to be stale.
 *
 *  2. Chunk-load failure: a lazy route that 404s ("Failed to fetch dynamically
 *     imported module") means this shell references a chunk the server no
 *     longer has. Reloading fetches the current index.html, whose chunks all
 *     exist.
 *
 * The once-per-build guard lives in sessionStorage: if reloading did not fix
 * it (server mid-deploy, network flake), looping on reloads would be worse
 * than the error page.
 */

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const GUARD_KEY = 'stale-build-reloaded-for';

// Defined by vite at build time; guard for test environments that do not.
const currentBuildId = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : null;

const reloadOnce = (reason) => {
    try {
        const guard = `${currentBuildId || 'unknown'}:${reason}`;
        if (sessionStorage.getItem(GUARD_KEY) === guard) return;
        sessionStorage.setItem(GUARD_KEY, guard);
    } catch {
        // Storage unavailable (private mode): reload anyway; the guard is a
        // nicety, and a single extra reload beats running dead code.
    }
    window.location.reload();
};

const checkVersion = async () => {
    if (!currentBuildId) return;
    try {
        const response = await fetch('/version.json', { cache: 'no-store' });
        if (!response.ok) return;
        const { buildId } = await response.json();
        if (buildId && buildId !== currentBuildId) {
            reloadOnce('version');
        }
    } catch {
        // Offline or mid-deploy; the next check will see the truth.
    }
};

const isChunkLoadFailure = (value) => {
    const text = String(value?.message || value || '');
    return (
        /Failed to fetch dynamically imported module/i.test(text) ||
        /Importing a module script failed/i.test(text) ||
        /ChunkLoadError/i.test(text) ||
        /Loading chunk [\w-]+ failed/i.test(text)
    );
};

export const installStaleBuildReload = () => {
    if (typeof window === 'undefined') return;

    window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkVersion();
    });
    setInterval(checkVersion, CHECK_INTERVAL_MS);

    // Lazy-route failures surface as unhandled promise rejections from the
    // dynamic import; direct script errors arrive on 'error'.
    window.addEventListener('unhandledrejection', (event) => {
        if (isChunkLoadFailure(event?.reason)) reloadOnce('chunk');
    });
    window.addEventListener('error', (event) => {
        if (isChunkLoadFailure(event?.message)) reloadOnce('chunk');
    });
};
