import { useState, useEffect } from 'react';
import { FiMenu, FiBell, FiLogOut } from 'react-icons/fi';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import Button from '../Button';
import NotificationWindow from './NotificationWindow';
import { adminAuthService } from '@sp/services/authService';

const AdminHeader = ({ onMenuClick }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [showNotifications, setShowNotifications] = useState(false);

  const handleLogout = async () => {
    try {
      await adminAuthService.logout();
      toast.success('Logged out successfully');
      navigate('/admin/login');
    } catch (error) {
      console.error('Logout error:', error);
      // Even if API call fails, clear local storage and redirect
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('adminData');
      toast.success('Logged out successfully');
      navigate('/admin/login');
    }
  };

  const toggleNotifications = () => {
    setShowNotifications(!showNotifications);
  };

  // Get page info from pathname
  const getPageInfo = (pathname) => {
    const mappings = [
      { path: '/admin/sp/dashboard', title: 'Dashboard', description: "Welcome back! Here's your business overview." },
      { path: '/admin/sp/users/all', title: 'All Users', description: 'Manage platform customers and their activity' },
      { path: '/admin/sp/users/bookings', title: 'User Bookings', description: 'Track customer booking history' },
      { path: '/admin/sp/users/analytics', title: 'User Analytics', description: 'Analyze customer behavior and growth' },
      { path: '/admin/sp/users/transactions', title: 'User Transactions', description: 'Monitor customer financial transactions' },
      { path: '/admin/sp/users', title: 'Users', description: 'Manage platform customers and their activity' },
      { path: '/admin/sp/vendors/all', title: 'All Vendors', description: 'Manage platform vendors and their activity' },
      { path: '/admin/sp/vendors/analytics', title: 'Vendor Analytics', description: 'Analyze vendor performance' },
      { path: '/admin/sp/vendors', title: 'Vendors', description: 'Manage vendor registrations and performance' },
      { path: '/admin/sp/workers/all', title: 'All Workers', description: 'Manage platform workers and their activity' },
      { path: '/admin/sp/workers/analytics', title: 'Worker Analytics', description: 'Analyze worker performance' },
      { path: '/admin/sp/workers', title: 'Workers', description: 'Monitor and manage platform workers' },
      { path: '/admin/sp/bookings', title: 'Bookings', description: 'Track and manage service bookings' },
      { path: '/admin/sp/bookings/notifications', title: 'Order Notifications', description: 'Track booking alerts and updates' },
      { path: '/admin/sp/user-categories', title: 'User Catalog', description: 'Manage platform services and categories' },
      { path: '/admin/sp/payments/users', title: 'User Transactions', description: 'Monitor customer financial transactions' },
      { path: '/admin/sp/payments/vendors', title: 'Vendor Transactions', description: 'Monitor vendor earnings and payouts' },
      { path: '/admin/sp/payments/workers', title: 'Worker Payments', description: 'Monitor and manage worker earnings and payouts' },
      { path: '/admin/sp/payments/revenue', title: 'Admin Revenue', description: 'Track platform commissions and income' },
      { path: '/admin/sp/payments/reports', title: 'Payment Report', description: 'Analyze payment data and financial insights' },
      { path: '/admin/sp/payments', title: 'Payments & Settlements', description: 'Monitor transactions and revenue' },
      { path: '/admin/sp/reports', title: 'Reports', description: 'Analyze platform performance with data insights' },
      { path: '/admin/sp/notifications', title: 'Notifications', description: 'Stay updated with platform activities' },
      { path: '/admin/sp/settings', title: 'Settings', description: 'Configure platform preferences' },
      { path: '/admin/sp/plans', title: 'Subscription Plans', description: 'Manage service subscription plans' },
      { path: '/admin/sp/services', title: 'Services', description: 'Manage platform service categories' },
      { path: '/admin/sp/services', title: 'Services', description: 'Manage platform service categories' },
      { path: '/admin/sp/settlements/pending', title: 'Pending Settlements', description: 'Review and approve vendor cash settlements' },
      { path: '/admin/sp/settlements/withdrawals', title: 'Withdrawal Requests', description: 'Manage vendor payout requests' },
      { path: '/admin/sp/settlements/vendors', title: 'Vendor Balances', description: 'Monitor vendor dues and credit limits' },
      { path: '/admin/sp/settlements/history', title: 'Settlement History', description: 'View past transaction records' },
      { path: '/admin/sp/settlements', title: 'Settlements', description: 'Manage financial settlements' },
      { path: '/admin/sp/reviews', title: 'Reviews', description: 'Manage platform reviews and ratings' },
      { path: '/admin/sp/scrap', title: 'Scrap Orders', description: 'Manage platform scrap collection orders' },
    ];

    const match = mappings.find(m => pathname === m.path || pathname.startsWith(m.path + '/'));

    if (match) return match;

    const path = pathname.split('/').pop() || 'dashboard';
    return {
      title: path.charAt(0).toUpperCase() + path.slice(1),
      description: `Manage your ${path} here.`
    };
  };

  const { title, description } = getPageInfo(location.pathname);

  // Notification Logic
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchNotifications = async () => {
    try {
      // Import api dynamically if needed or just use fetch with auth headers
      // Since we don't have api imported, let's use adminAuthService's axios instance if available, or just fetch
      // Assuming api.js handles interceptors. Let's import api at top.
      const { default: api } = await import('@sp/services/api');
      const res = await api.get('/notifications/admin');
      if (res.data.success) {
        setNotifications(res.data.data);
        setUnreadCount(res.data.unreadCount);
      }
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    }
  };

  useEffect(() => {
    fetchNotifications();
    // Optional: Poll every 60 seconds
    const interval = setInterval(fetchNotifications, 60000);
    return () => clearInterval(interval);
  }, []);

  const handleMarkAsRead = async (id) => {
    try {
      const { default: api } = await import('@sp/services/api');
      await api.put(`/notifications/${id}/read`);
      // Optimistic update
      setNotifications(prev => prev.map(n => n._id === id ? { ...n, isRead: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Error marking as read:', error);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      const { default: api } = await import('@sp/services/api');
      await api.put(`/notifications/read-all`);
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch (error) {
      console.error('Error marking all as read:', error);
    }
  };

  const handleDelete = async (id) => {
    try {
      const { default: api } = await import('@sp/services/api');
      await api.delete(`/notifications/${id}`);
      setNotifications(prev => prev.filter(n => n._id !== id));
      // If deleted was unread, decrease count? We don't know easily without checking.
      // Ideally re-fetch or check current state
      fetchNotifications();
    } catch (error) {
      console.error('Error deleting notification:', error);
    }
  };

  return (
    <header
      // lg:left-80 must match the sidebar's w-80 (AdminSidebar) and the content's
      // lg:ml-80 (AdminLayout). It was 278px, so on desktop this fixed header drew
      // over the right 42px of the sidebar's top and clipped the brand block.
      className="bg-white fixed top-0 left-0 right-0 z-30 transition-all duration-300 lg:left-80 border-b border-gray-100 shadow-sm"
      style={{
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}
    >
      <div className="flex items-center justify-between px-4 lg:px-6 py-6">
        {/* Left: Menu Button & Page Title */}
        <div className="flex items-center gap-4">
          <Button
            onClick={onMenuClick}
            variant="icon"
            className="lg:hidden text-gray-700"
            icon={FiMenu}
          />
          <div>
            <h1 className="text-2xl font-bold text-gray-800 mb-1">{title}</h1>
            <p className="text-[10px] sm:text-xs text-gray-500 font-medium">{description}</p>
          </div>
        </div>

        {/* Right: Notifications & Logout */}
        <div className="flex items-center gap-4">
          {/* Notifications 
          <div className="relative">
            <Button
              data-notification-button
              onClick={toggleNotifications}
              variant="icon"
              className="text-gray-700"
              icon={FiBell}
            />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 rounded-full text-[10px] text-white flex items-center justify-center font-bold">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}

            <NotificationWindow
              isOpen={showNotifications}
              onClose={() => setShowNotifications(false)}
              position="right"
              notifications={notifications}
              onMarkAsRead={handleMarkAsRead}
              onMarkAllAsRead={handleMarkAllAsRead}
              onDelete={handleDelete}
            />
          </div>
          */}

          {/* Logout Button */}
          <Button
            onClick={handleLogout}
            variant="ghost"
            icon={FiLogOut}
            size="sm"
            className="text-gray-700 hover:bg-red-600 hover:text-white hover:border-red-600 border border-gray-300"
          >
            Logout
          </Button>
        </div>
      </div>
    </header>
  );
};

export default AdminHeader;


