import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FiSearch, FiFilter, FiLoader, FiCalendar, FiClock, FiUser, FiMapPin } from 'react-icons/fi';
import { toast } from 'react-hot-toast';
import CardShell from '../UserCategories/components/CardShell';
import adminWorkerService from '@sp/services/adminWorkerService';

const WorkerJobs = () => {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0 });

  const loadJobs = async (page = 1) => {
    try {
      setLoading(true);
      const params = {
        page,
        limit: pagination.limit,
        status: filterStatus === 'all' ? undefined : filterStatus,
        search: searchQuery || undefined
      };
      const response = await adminWorkerService.getAllJobs(params);
      if (response.success) {
        setJobs(response.data);
        setPagination(response.pagination);
      }
    } catch (error) {
      console.error('Error loading jobs:', error);
      toast.error('Failed to load worker jobs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJobs();
  }, [filterStatus, searchQuery]);

  const getStatusStyle = (status) => {
    const styles = {
      pending: 'bg-yellow-100 text-yellow-800',
      confirmed: 'bg-blue-100 text-blue-800',
      ongoing: 'bg-purple-100 text-purple-800',
      completed: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800'
    };
    return styles[status] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="space-y-6">
      <CardShell
        icon={FiClock}
      >
        {/* Search and Filter */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="flex-1 relative">
            <div className="absolute left-4 top-1/2 transform -translate-y-1/2">
              <FiSearch className="w-5 h-5 text-gray-400" />
            </div>
            <input
              type="text"
              placeholder="Search by worker name or phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="ongoing">Ongoing</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        {/* Jobs List */}
        <div className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <FiLoader className="w-8 h-8 text-gray-400 animate-spin mr-3" />
              <span className="text-gray-600">Loading jobs...</span>
            </div>
          ) : jobs.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No jobs found matching your criteria</div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {jobs.map((job) => (
                <motion.div
                  key={job._id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow bg-white"
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className="bg-primary-50 p-3 rounded-lg">
                        <FiCalendar className="text-primary-600 w-6 h-6" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-bold text-gray-900">{job.serviceId?.title || 'General Service'}</h4>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getStatusStyle(job.status)}`}>
                            {job.status.toUpperCase()}
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm text-gray-600">
                          <div className="flex items-center gap-2">
                            <FiUser className="w-4 h-4" />
                            <span>Worker: <span className="font-medium text-gray-800">{job.workerId?.name || 'Unassigned'}</span></span>
                          </div>
                          <div className="flex items-center gap-2">
                            <FiUser className="w-4 h-4 text-blue-500" />
                            <span>Customer: <span className="font-medium text-gray-800">{job.userId?.name}</span></span>
                          </div>
                          <div className="flex items-center gap-2">
                            <FiCalendar className="w-4 h-4" />
                            <span>Date: {new Date(job.scheduledDate).toLocaleDateString()}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <FiClock className="w-4 h-4" />
                            <span>Time: {job.scheduledTime}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <div className="text-lg font-bold text-gray-900">₹{job.finalAmount}</div>
                      {/* <button className="text-sm text-primary-600 font-semibold hover:underline">View Full Details</button> */}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        {!loading && pagination.pages > 1 && (
          <div className="flex justify-center mt-8 gap-2">
            {[...Array(pagination.pages)].map((_, i) => (
              <button
                key={i}
                onClick={() => loadJobs(i + 1)}
                className={`w-10 h-10 rounded-lg font-semibold transition-all ${pagination.page === i + 1
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        )}
      </CardShell>
    </div>
  );
};

export default WorkerJobs;

