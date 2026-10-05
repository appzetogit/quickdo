import { useState, useEffect, useRef } from "react"
import { Outlet, useLocation } from "react-router-dom"
import AdminSidebar from "./AdminSidebar"
import AdminNavbar from "./AdminNavbar"
import AdminPageGate from "./AdminPageGate"
import { API_BASE_URL } from "@food/api/config"
import { ContentPageSkeleton } from "@food/components/ui/loading-skeletons"

const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

export default function AdminLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const location = useLocation();
  const [isNavigating, setIsNavigating] = useState(false);
  const prevPathRef = useRef(location.pathname);

  // Get initial collapsed state from localStorage to set initial margin
  useEffect(() => {
    try {
      const saved = localStorage.getItem('admin_sidebar_state')
      if (saved !== null) {
        const state = JSON.parse(saved)
        if (state && typeof state.isCollapsed !== 'undefined') {
          setIsSidebarCollapsed(state.isCollapsed)
        }
      }
    } catch (e) {
      debugError('Error loading sidebar collapsed state:', e)
    }
  }, [])

  // Page navigation skeleton effect
  useEffect(() => {
    if (prevPathRef.current !== location.pathname) {
      setIsNavigating(true);
      const timer = setTimeout(() => setIsNavigating(false), 400);
      prevPathRef.current = location.pathname;
      return () => clearTimeout(timer);
    }
  }, [location.pathname]);

  const handleCollapseChange = (collapsed) => {
    setIsSidebarCollapsed(collapsed)
  }

  return (
    <div className="h-screen bg-neutral-200 flex overflow-hidden">
      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-gray-900/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <AdminSidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onCollapseChange={handleCollapseChange}
      />

      {/* Main Content Area */}
      <div className={`
        flex-1 flex min-h-0 flex-col transition-all duration-300 ease-in-out min-w-0
        ${isSidebarCollapsed ? 'lg:ml-20' : 'lg:ml-80'}
      `}>
        {/* Top Navbar */}
        <AdminNavbar onMenuClick={() => setSidebarOpen(!sidebarOpen)} />

        {/* Backend disconnected banner */}
        {!API_BASE_URL && (
          <div className="w-full bg-amber-100 border-b border-amber-300 px-4 py-2 text-center text-sm text-amber-900">
            Backend disconnected. Data is not live.
          </div>
        )}

        {/* Page Content */}
        <main className="flex-1 min-h-0 w-full max-w-full overflow-x-hidden overflow-y-auto bg-neutral-100">
          {isNavigating ? (
             <div className="p-4 lg:p-6 w-full h-full">
                <ContentPageSkeleton hero={false} className="bg-transparent dark:bg-transparent min-h-0" />
             </div>
          ) : (
             <AdminPageGate>
               <Outlet />
             </AdminPageGate>
          )}
        </main>
      </div>
    </div>
  );
}

