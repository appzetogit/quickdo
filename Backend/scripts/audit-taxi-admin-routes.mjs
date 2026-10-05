/**
 * Which taxi admin screens call something the server does not answer.
 *
 * Run: node scripts/audit-taxi-admin-routes.mjs
 *
 * A button that calls a path no router declares fails with a 404, and the
 * screen reports it in whatever words it has -- "failed to save", "could not
 * load", or nothing at all. It reads as a dead feature and is really a missing
 * line in a router. That is how the medical Accept button came to answer 404 on
 * every quick-commerce order: the panel PATCHed `/orders/:id/status` and that
 * fork only declared `/accept`. The taxi panel had thirteen more of the same,
 * all of the rental screens, whose routes had been commented out since the
 * module was first committed.
 *
 * So this reads both sides and diffs them:
 *
 *   - every path the taxi admin pages call, with its method, resolved through
 *     whichever base-url variable the screen happens to use;
 *   - every route the taxi admin module actually declares, including the ones
 *     contributed by routers mounted inside it.
 *
 * WHAT IT CANNOT SEE, and says so rather than passing over in silence:
 *
 *   - a path assembled at runtime from a value it cannot resolve;
 *   - a call to another module's admin API, which is not this router's to
 *     answer and is listed separately rather than as dead;
 *   - whether a route that exists actually works. This proves the door is
 *     there, not that the room behind it is furnished.
 *
 * Every one of those limits cost a wrong answer while this was being written:
 * reading the default export of a module whose router is a named one reported
 * all 237 calls dead; scanning the whole Taxi module reported 232, nearly all
 * alive on the driver and rider routers; and reading adminRoutes.js alone
 * reported /admin/banners dead when it is declared by the promotions router
 * mounted inside it. A reader that cannot see the server must stop, not answer
 * "everything is broken".
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
/*
 * The admin panel only. The Taxi module also holds the driver and rider apps'
 * web code, whose calls are answered by other routers; counting those here is
 * the difference between a useful list and a frightening one.
 */
const panelRoot = join(
    backendRoot, '..', 'Frontend', 'src', 'modules', 'Taxi', 'modules', 'admin',
);

/* ------------------------------------------------------------- the server */

const routerModule = await import('../src/modules/taxi/admin/routes/index.js');
const adminRouter = routerModule.adminModuleRouter || routerModule.default;
if (!adminRouter?.stack?.length) {
    console.error('[audit] Could not read the taxi admin router. Aborting rather');
    console.error('        than reporting every call in the panel as dead.');
    process.exit(2);
}

const declared = new Set();
const declaredPaths = new Set();

/** A mounted router's own prefix, recovered from its layer's path regexp. */
const prefixOf = (layer) => {
    const source = layer?.regexp?.source || '';
    if (layer?.regexp?.fast_slash || source === '^\\/?(?=\\/|$)') return '';
    const m = /^\^\\\/((?:[A-Za-z0-9_\-~%.]|\\\/)*)/.exec(source);
    return m ? `/${m[1].replace(/\\\//g, '/')}` : '';
};

const collect = (router, prefix = '') => {
    for (const layer of router?.stack || []) {
        if (layer?.route?.path) {
            const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
            for (const one of paths) {
                const full = `${prefix}${one}`.replace(/\/{2,}/g, '/');
                declaredPaths.add(full);
                for (const method of Object.keys(layer.route.methods || {})) {
                    declared.add(`${method.toUpperCase()} ${full}`);
                }
            }
            continue;
        }
        const nested = layer?.handle;
        if (nested?.stack) collect(nested, `${prefix}${prefixOf(layer)}`);
    }
};
collect(adminRouter);

const asPattern = (route) => new RegExp(
    `^${route.replace(/:[A-Za-z0-9_]+/g, '[^/]+').replace(/\//g, '\\/')}$`,
);
const routePatterns = [...declaredPaths].map((route) => ({ route, re: asPattern(route) }));

const answersFor = (path) => {
    const hit = routePatterns.find((r) => r.re.test(path));
    if (!hit) return null;
    return {
        route: hit.route,
        methods: [...declared]
            .filter((d) => d.endsWith(` ${hit.route}`))
            .map((d) => d.split(' ')[0]),
    };
};

/* -------------------------------------------------------------- the panel */

const files = [];
const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const info = statSync(full);
        if (info.isDirectory()) walk(full);
        else if (/\.jsx?$/.test(entry)) files.push(full);
    }
};
walk(panelRoot);

const TAXI_ROOT = '/api/v1/taxi';

/**
 * What a base-url variable resolves to, relative to the taxi API root.
 *
 * `${ORIGIN}/api/v1/taxi/admin` -> `/admin`. A base pointing at another
 * module's API returns null, and its calls are reported apart from the dead
 * ones: they are somebody else's routes and this router cannot answer for them.
 */
const resolveBase = (expression, known) => {
    let value = expression.trim().replace(/^\(\)\s*=>\s*/, '');
    for (const [name, resolved] of Object.entries(known)) {
        if (resolved === null) continue;
        value = value.split(`\${${name}}`).join(resolved).split(name).join(resolved);
    }
    const cleaned = value.replace(/[`'"]/g, '').replace(/\s*\+\s*/g, '');
    const taxiAt = cleaned.indexOf(TAXI_ROOT);
    if (taxiAt !== -1) return cleaned.slice(taxiAt + TAXI_ROOT.length) || '/';
    if (cleaned.includes('API_BASE_URL')) {
        return cleaned.slice(cleaned.indexOf('API_BASE_URL') + 'API_BASE_URL'.length) || '/';
    }
    if (cleaned.includes('/api/v1/')) return null; // another module's admin
    return null;
};

const calls = new Map();
const foreign = new Map();
const unreadable = [];

const record = (store, path, method, file) => {
    const key = `${method} ${path}`;
    if (!store.has(key)) store.set(key, new Set());
    store.get(key).add(relative(panelRoot, file).split(sep).join('/'));
};

/** `/types/set-prices/${id}` -> `/types/set-prices/:x`, and drop the query. */
const normalise = (raw) => raw
    .replace(/\$\{[^}]*\}/g, ':x')
    .replace(/\?.*$/, '')
    .replace(/\/+$/, '');

for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const shown = relative(panelRoot, file).split(sep).join('/');

    const known = {};
    for (const m of text.matchAll(/const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;\n]+);/g)) {
        const [, name, expression] = m;
        if (!/api\/v1|API_BASE_URL|API_ORIGIN|LEGACY_BACKEND_ORIGIN|baseUrl|BASE\b/.test(expression)) continue;
        known[name] = resolveBase(expression, known);
    }

    for (const m of text.matchAll(/fetch\(\s*`\$\{(\w+)\}([^`]*)`\s*(?:,\s*\{([\s\S]{0,400}?)\})?/g)) {
        const [, baseName, rawPath, options = ''] = m;
        const prefix = known[baseName];
        if (prefix === undefined) {
            unreadable.push(`${shown}: base "${baseName}" not resolved`);
            continue;
        }
        const path = normalise((prefix === '/' ? '' : prefix) + rawPath);
        const explicit = /method:\s*['"`](\w+)['"`]/.exec(options);
        const store = prefix === null ? foreign : calls;
        if (explicit) {
            record(store, path, explicit[1].toUpperCase(), file);
        } else if (/method\s*[,:]/.test(options)) {
            // The verb is in a variable: the screen sends more than one and we
            // cannot tell which from here, so both halves are checked.
            record(store, path, 'POST', file);
            record(store, path, 'PATCH', file);
        } else {
            record(store, path, 'GET', file);
        }
    }

    // The shared axios instance's baseURL is the taxi API root, so these paths
    // are already taxi-relative. Only `/admin` ones are this router's to answer.
    for (const m of text.matchAll(/\bapi\.(get|post|put|patch|delete)\(\s*[`'"]([^`'"]+)[`'"]/g)) {
        const [, verb, rawPath] = m;
        if (!rawPath.startsWith('/admin')) continue;
        record(calls, normalise(rawPath), verb.toUpperCase(), file);
    }
}

/* ---------------------------------------------------------------- the diff */

const dead = [];
const wrongVerb = [];

for (const [key, screens] of [...calls].sort()) {
    const [method, path] = key.split(' ');
    if (!path.startsWith('/admin')) continue;
    const hit = answersFor(path);
    if (!hit) {
        dead.push({ method, path, screens: [...screens] });
    } else if (!hit.methods.includes(method)) {
        wrongVerb.push({ method, path, answers: hit.methods, screens: [...screens] });
    }
}

console.log(`\ntaxi admin routes declared : ${declared.size}`);
console.log(`panel calls resolved       : ${calls.size}`);
console.log(`calls to another module    : ${foreign.size}`);
if (unreadable.length) console.log(`bases not resolved         : ${unreadable.length}`);
console.log('');

if (!dead.length && !wrongVerb.length) {
    console.log('Every taxi admin call the panel makes has a route behind it.\n');
} else {
    if (dead.length) {
        console.log(`NO SUCH ROUTE -- these 404 (${dead.length}):\n`);
        for (const row of dead) {
            console.log(`  ${row.method.padEnd(6)} ${row.path}`);
            for (const screen of row.screens) console.log(`         ${screen}`);
        }
        console.log('');
    }
    if (wrongVerb.length) {
        console.log(`NO ROUTE FOR THIS METHOD (${wrongVerb.length}):\n`);
        for (const row of wrongVerb) {
            console.log(`  ${row.method.padEnd(6)} ${row.path}  -- server answers ${row.answers.join(', ')}`);
            for (const screen of row.screens) console.log(`         ${screen}`);
        }
        console.log('');
    }
}

if (foreign.size) {
    console.log("Calls to another module's admin API (not this router's to answer):");
    for (const [key, screens] of [...foreign].sort()) {
        console.log(`  ${key}  <- ${[...screens].join(', ')}`);
    }
    console.log('');
}
if (unreadable.length) {
    console.log('Bases this reader could not resolve -- check these by hand:');
    for (const line of [...new Set(unreadable)].slice(0, 20)) console.log(`  ${line}`);
    console.log('');
}

process.exit(dead.length + wrongVerb.length > 0 ? 1 : 0);
