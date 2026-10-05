/**
 * The /qc namespace's adapter, which decides whether QC realtime survives a
 * second process.
 *
 * Run: node tests/qc-socket-namespace.smoke.mjs
 *
 * The quick-commerce socket init used to carry a copy of the root server's
 * Redis block, including `io.adapter(createAdapter(pub, sub))`. On a Server
 * that is a setter; on a Namespace, `adapter` is the adapter INSTANCE, so the
 * call threw `io.adapter is not a function` every boot. The catch around it
 * logged "Socket.IO Redis adapter skipped (using in-memory)" -- which read like
 * a deliberate fallback, was untrue, and left two Redis connections open and
 * unused for the life of the process.
 *
 * What these checks pin is the thing that was never actually broken and must
 * not become broken: a namespace inherits the server's adapter, so /qc is
 * Redis-backed whenever master is, without attaching anything of its own.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { Server } from 'socket.io';
import { Adapter } from 'socket.io-adapter';

let failed = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  PASS  ${label}`);
    } catch (err) {
        failed += 1;
        console.log(`  FAIL  ${label}\n        ${err.message}`);
    }
};

/** Stands in for the Redis adapter: same contract, no Redis. */
class StubAdapter extends Adapter {}

/*
 * Redis on, so the block that used to throw would run if it came back. Without
 * this the old code was simply skipped and these checks passed against the bug.
 * Nothing here connects to Redis -- the adapter under test is a stub.
 */
process.env.REDIS_ENABLED = 'true';
process.env.REDIS_URL ||= 'redis://127.0.0.1:6379';

const { logger } = await import('../src/modules/quickCommerce/utils/logger.js');
const { initSocket, getIO } = await import('../src/modules/quickCommerce/config/socket.js');

// Captured so a silent "skipped" warning cannot pass unnoticed again.
const warnings = [];
const realWarn = logger.warn.bind(logger);
logger.warn = (...args) => {
    warnings.push(args.map(String).join(' '));
};

const httpServer = http.createServer();
const rootIo = new Server(httpServer);

// server.js sets the root adapter in initSocket() and calls the QC init after,
// so that is the order under test.
rootIo.adapter(StubAdapter);
const namespace = await initSocket(rootIo);

console.log('\nthe namespace master hands to quick commerce');

await check('it is /qc, not the root server', () => {
    assert.ok(namespace, 'initSocket returned nothing');
    assert.equal(namespace.name, '/qc');
    assert.notEqual(namespace, rootIo, 'QC was handed the root server itself');
});

await check('getIO() answers with the same namespace', () => {
    assert.equal(getIO(), namespace);
});

await check(
    'THE BUG IT PREVENTS: it inherits the server\'s adapter rather than the in-memory one',
    () => {
        assert.ok(
            namespace.adapter instanceof StubAdapter,
            `QC rooms are on ${namespace.adapter?.constructor?.name} -- emits will not cross processes`,
        );
    },
);

await check('the root namespace has it too, from the same setting', () => {
    assert.ok(rootIo.of('/').adapter instanceof StubAdapter);
});

await check('and nothing was logged claiming the adapter was skipped', () => {
    const noisy = warnings.filter((line) => /adapter/i.test(line));
    assert.deepEqual(noisy, [], `warned: ${noisy.join(' | ')}`);
});

// A namespace's rooms are its own, which is why this is worth having at all:
// the food module's `user:<id>` and QC's must not be the same room.
await check('its rooms are scoped to it, not shared with the root', () => {
    assert.notEqual(namespace.adapter, rootIo.of('/').adapter);
});

console.log('\nthe order the adapter is set in');

await check(
    'setting the adapter AFTER the namespace exists still reaches it',
    () => {
        // socket.io's Server#adapter re-initialises every namespace it already
        // has, so a future reordering of server.js does not silently drop QC
        // back to in-memory. Worth knowing rather than assuming.
        class LateAdapter extends Adapter {}
        rootIo.adapter(LateAdapter);
        assert.ok(
            namespace.adapter instanceof LateAdapter,
            `namespace kept ${namespace.adapter?.constructor?.name}`,
        );
    },
);

logger.warn = realWarn;
rootIo.close();
httpServer.close();

console.log(failed ? `\n  ${failed} FAILED\n` : '\n  all checks passed\n');
process.exit(failed ? 1 : 0);
