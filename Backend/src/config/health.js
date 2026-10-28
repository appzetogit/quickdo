import mongoose from 'mongoose';
import { config } from './env.js';
import { getRedisClient } from './redis.js';

/**
 * Minimal health check: server, MongoDB, Redis (if enabled).
 * Does not expose internal secrets.
 */
export const healthCheck = async () => {
    const mongoState = mongoose.connection.readyState;
    const mongoOk = mongoState === 1; // 1 = connected

    let redisOk = null;
    if (config.redisEnabled) {
        const client = getRedisClient();
        redisOk = client ? 'ok' : 'unavailable';
        if (client) {
            try {
                await client.ping();
            } catch {
                redisOk = 'unavailable';
            }
        }
    } else {
        redisOk = 'disabled';
    }

    // Three states, not two, because they call for different operator responses:
    //
    //   DOWN     - no MongoDB. The API cannot serve a single meaningful request, so a
    //              deploy that reaches this state must be treated as failed.
    //   DEGRADED - MongoDB is up but Redis (rate limits, cache, socket fan-out) is not.
    //              Still serving, worth an alert, NOT worth failing a deploy or pulling
    //              the instance out of the load balancer.
    //   UP       - everything configured is answering.
    //
    // This used to be hardcoded to 'UP'. A server that came up with no database still
    // reported healthy, which made the status field decorative: nothing downstream --
    // a deploy gate, an uptime monitor, a load-balancer probe -- could tell a working
    // instance from a broken one.
    const redisDown = config.redisEnabled && redisOk !== 'ok';
    const status = !mongoOk ? 'DOWN' : (redisDown ? 'DEGRADED' : 'UP');

    return {
        status,
        mongo: mongoOk ? 'connected' : 'disconnected',
        redis: redisOk
    };
};
