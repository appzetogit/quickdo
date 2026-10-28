/**
 * Modules a deployment can switch on without its own branch.
 *
 * Several sites run this same code from `main`: quickdropsindia.com, and
 * superapp.buytogetherindia.com, which also offers the Service Provider module.
 * A branch per site would drift -- every fix to main merged by hand, and one site
 * eventually missing one -- so a site opts in through its build settings
 * (Frontend/.env.production) instead.
 *
 * Read at BUILD time: Vite inlines import.meta.env, so a site that leaves this
 * unset gets a build where the module's entry points are simply absent.
 */

const on = (value) => String(value ?? '').trim().toLowerCase() === 'true';

/**
 * The Service Provider (Services) admin: the /admin/sp routes and the Services
 * tab in both panel switchers. Off unless VITE_ENABLE_SERVICE_PROVIDER=true.
 */
export const SERVICE_PROVIDER_ENABLED = on(import.meta.env.VITE_ENABLE_SERVICE_PROVIDER);
