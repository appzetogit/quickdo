import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { FiMail, FiLock, FiEye, FiEyeOff } from 'react-icons/fi';
import { toast } from 'react-hot-toast';
import { themeColors } from '@sp/theme';
import { adminAuthService } from '@sp/services/authService';
import Logo from '@sp/components/common/Logo';

const AdminLogin = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    email: 'admin@admin.com',
    password: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);



  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.email || !formData.password) {
      toast.error('Please enter both email and password');
      return;
    }

    setIsLoading(true);
    try {
      const response = await adminAuthService.login(formData.email, formData.password, rememberMe);
      if (response.success) {
        setIsLoading(false);
        // Store remember me preference
        if (rememberMe) {
          localStorage.setItem('adminRememberMe', 'true');
        }
        toast.success('Login successful!');
        navigate('/admin/sp/dashboard');
      } else {
        setIsLoading(false);
        toast.error(response.message || 'Login failed'); // Reading file to debug token key mismatch (error)
      }
    } catch (error) {
      setIsLoading(false);
      toast.error(error.response?.data?.message || 'Login failed. Please check your credentials.');
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{
        background: 'linear-gradient(135deg, #00a6a6 0%, #008a8a 50%, #006b6b 100%)'
      }}
    >
      <div className="w-full max-w-md">
        {/* White Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {/* Icon */}
          <div className="flex justify-center mb-6">
            <Logo className="h-16 w-auto" />
          </div>

          {/* Title */}
          <h1 className="text-3xl font-bold text-gray-900 text-center mb-2">
            Admin Login
          </h1>
          <p className="text-gray-600 text-center mb-8">
            Enter your credentials to access the admin panel
          </p>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Email Field */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Email Address
              </label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 transform -translate-y-1/2">
                  <FiMail className="w-5 h-5 text-gray-400" />
                </div>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  placeholder="admin@admin.com"
                  className="w-full pl-12 pr-4 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent text-gray-900"
                  style={{
                    focusRingColor: themeColors.button
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = themeColors.button;
                    e.target.style.boxShadow = `0 0 0 3px rgba(0, 166, 166, 0.1)`;
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = '#d1d5db';
                    e.target.style.boxShadow = 'none';
                  }}
                  required
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Password
              </label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 transform -translate-y-1/2">
                  <FiLock className="w-5 h-5 text-gray-400" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  placeholder="Enter your password"
                  className="w-full pl-12 pr-12 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent text-gray-900"
                  onFocus={(e) => {
                    e.target.style.borderColor = themeColors.button;
                    e.target.style.boxShadow = `0 0 0 3px rgba(0, 166, 166, 0.1)`;
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = '#d1d5db';
                    e.target.style.boxShadow = 'none';
                  }}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <FiEyeOff className="w-5 h-5" /> : <FiEye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* Remember Me */}
            <div className="flex items-center">
              <input
                type="checkbox"
                id="rememberMe"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-4 h-4 border-gray-300 rounded"
                style={{
                  accentColor: themeColors.button
                }}
              />
              <label htmlFor="rememberMe" className="ml-2 text-sm text-gray-700">
                Remember me
              </label>
            </div>

            {/* Login Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 rounded-xl text-white font-semibold text-lg transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: `linear-gradient(135deg, ${themeColors.button} 0%, #008a8a 100%)`,
                boxShadow: '0 4px 12px rgba(0, 166, 166, 0.3)'
              }}
              onMouseEnter={(e) => {
                if (!e.currentTarget.disabled) {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 6px 16px rgba(0, 166, 166, 0.4)';
                  e.currentTarget.style.background = 'linear-gradient(135deg, #008a8a 0%, #006b6b 100%)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 166, 166, 0.3)';
                e.currentTarget.style.background = `linear-gradient(135deg, ${themeColors.button} 0%, #008a8a 100%)`;
              }}
            >
              {isLoading ? 'Logging in...' : 'Login'}
            </button>
          </form>

          {/* Demo Credentials */}
          <div
            className="mt-8 p-4 rounded-xl"
            style={{
              background: 'linear-gradient(135deg, rgba(0, 166, 166, 0.1) 0%, rgba(0, 138, 138, 0.05) 100%)',
              border: '1px solid rgba(0, 166, 166, 0.2)'
            }}
          >
            <h3 className="text-sm font-semibold mb-2" style={{ color: themeColors.button }}>Demo Credentials:</h3>
            <div className="text-sm text-gray-700 space-y-1">
              <p>Email: admin@admin.com</p>
              <p>Password: admin123</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminLogin;


