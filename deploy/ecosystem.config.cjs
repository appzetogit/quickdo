/**
 * pm2 config for the SIDE-BY-SIDE super-app instance.
 *
 * This box runs 12 other pm2 apps, including `k9-backend` (/opt/k9, port 5005,
 * serving k9.appzeto.com) which is the LIVE pre-integration build of this same
 * project. Nothing here may collide with it:
 *
 *   name  master-api   (live one is `k9-backend`)
 *   cwd   /opt/master   (live one is /opt/k9)
 *   port  5007          (live one is 5005)
 *   db    the database name must be in the MONGODB_URI PATH.
 *
 * That last point is not a style preference. src/config/db.js calls
 * mongoose.connect(uri) with NO dbName option, and MONGODB_DB_NAME is read nowhere
 * in the codebase -- so the database comes from the URI path alone, and defaults to
 * `test` when the URI has none. Setting MONGODB_DB_NAME on a staging instance looks
 * like isolation and gives you none: the process joins whatever the live app uses.
 * server.js seeds on boot and the SP scheduler polls every 5s, so that matters.
 *
 * Start:   pm2 start deploy/ecosystem.config.cjs
 * Reload:  pm2 reload master-api
 * Never:   pm2 delete all / pm2 kill / pm2 restart all  <- would take down 12 live apps
 */
module.exports = {
  apps: [
    {
      name: 'master-api',
      cwd: '/opt/master/Backend',
      script: 'server.js',
      // fork, not cluster: the SP booking scheduler and the socket namespace are
      // singletons. Two workers would double every vendor alert.
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '20s',
      max_memory_restart: '600M',
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 5007
      },
      error_file: '/var/log/pm2/master-api.error.log',
      out_file: '/var/log/pm2/master-api.out.log',
      merge_logs: true,
      time: true,
      // Give in-flight requests time to drain; server.js runs its own graceful
      // shutdown on SIGTERM with a 10s ceiling.
      kill_timeout: 12000
    },
    {
      // The BullMQ consumers.
      //
      // package.json declares six worker entrypoints and this file started NONE of
      // them. With BULLMQ_ENABLED=true the API happily enqueues OTP sends, order
      // dispatch retries, tracking updates and payment reconciliation into queues
      // nothing consumes -- they grow forever and no error appears anywhere, because
      // a producer succeeds whether or not a consumer exists.
      //
      // src/queues/workers/index.js runs all six in one process; see the note there
      // for why one process rather than six pm2 apps.
      name: 'master-workers',
      cwd: '/opt/master/Backend',
      script: 'src/queues/workers/index.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '20s',
      max_memory_restart: '500M',
      watch: false,
      env: {
        NODE_ENV: 'production'
      },
      // Longer than the API: workers wait for in-flight jobs (SHUTDOWN_TIMEOUT_MS is
      // 15s in the bundle entrypoint).
      kill_timeout: 20000,
      error_file: '/var/log/pm2/master-workers.error.log',
      out_file: '/var/log/pm2/master-workers.out.log',
      merge_logs: true,
      time: true
    }
  ]
};
