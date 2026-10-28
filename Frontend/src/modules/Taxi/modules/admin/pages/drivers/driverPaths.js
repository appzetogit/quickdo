import { useLocation } from 'react-router-dom';

/**
 * Where the driver screens live for the panel they were opened from.
 *
 * The same pages serve the Taxi panel (/taxi/admin/drivers) and Master
 * (/admin/master/taxi-drivers, /admin/master/partner-documents). Links between
 * them follow the panel, so an admin working in Master stays in Master.
 */
export function useDriverPaths() {
  const { pathname } = useLocation();
  const master = pathname.startsWith('/admin/master');
  return {
    drivers: master ? '/admin/master/taxi-drivers' : '/taxi/admin/drivers',
    docs: master ? '/admin/master/partner-documents' : '/taxi/admin/drivers/documents',
  };
}
