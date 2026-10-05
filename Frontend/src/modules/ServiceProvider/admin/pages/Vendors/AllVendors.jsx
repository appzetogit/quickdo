import React, { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FiCheck, FiX, FiEye, FiSearch, FiFilter, FiDownload, FiLoader, FiPower, FiTrash2 } from 'react-icons/fi';
import { toast } from 'react-hot-toast';
import CardShell from '../UserCategories/components/CardShell';
import Modal from '../UserCategories/components/Modal';
import adminVendorService from '@sp/services/adminVendorService';

const AllVendors = () => {
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all'); // 'all', 'pending', 'approved', 'rejected'
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);

  // Load vendors from backend
  useEffect(() => {
    loadVendors();
  }, []);

  const loadVendors = async () => {
    try {
      setLoading(true);
      const response = await adminVendorService.getAllVendors();
      if (response.success) {
        // Transform backend data to frontend format
        const transformedVendors = response.data.map(vendor => ({
          id: vendor._id,
          name: vendor.name,
          email: vendor.email,
          phone: vendor.phone,
          businessName: vendor.businessName,
          service: vendor.service,
          approvalStatus: vendor.approvalStatus,
          aadhar: vendor.aadhar?.number,
          pan: vendor.pan?.number,
          documents: {
            aadhar: vendor.aadhar?.document,
            aadharBack: vendor.aadhar?.backDocument,
            pan: vendor.pan?.document,
            other: vendor.otherDocuments?.[0]
          },
          createdAt: vendor.createdAt,
          isActive: vendor.isActive
        }));
        setVendors(transformedVendors);
      } else {
        toast.error(response.message || 'Failed to load vendors');
      }
    } catch (error) {
      console.error('Error loading vendors:', error);
      toast.error('Failed to load vendors. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const filteredVendors = useMemo(() => {
    return vendors.filter(vendor => {
      const serviceString = Array.isArray(vendor.service)
        ? vendor.service.join(' ')
        : (vendor.service || '');

      const matchesStatus = filterStatus === 'all' || vendor.approvalStatus === filterStatus;

      const matchesSearch =
        vendor.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        vendor.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        vendor.phone.includes(searchQuery) ||
        serviceString.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (vendor.businessName && vendor.businessName.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchesStatus && matchesSearch;
    });
  }, [vendors, filterStatus, searchQuery]);

  const handleApprove = async (vendorId) => {
    try {
      const response = await adminVendorService.approveVendor(vendorId);
      if (response.success) {
        setVendors(prev => prev.map(v =>
          v.id === vendorId ? { ...v, approvalStatus: 'approved' } : v
        ));
        toast.success('Vendor approved successfully!');
      } else {
        toast.error(response.message || 'Failed to approve vendor');
      }
    } catch (error) {
      console.error('Error approving vendor:', error);
      toast.error('Failed to approve vendor. Please try again.');
    }
  };

  const handleReject = async (vendorId) => {
    try {
      const response = await adminVendorService.rejectVendor(vendorId);
      if (response.success) {
        setVendors(prev => prev.map(v =>
          v.id === vendorId ? { ...v, approvalStatus: 'rejected' } : v
        ));
        toast.success('Vendor rejected successfully.');
      } else {
        toast.error(response.message || 'Failed to reject vendor');
      }
    } catch (error) {
      console.error('Error rejecting vendor:', error);
      toast.error('Failed to reject vendor. Please try again.');
    }
  };

  const handleToggleStatus = async (vendorId, currentStatus) => {
    try {
      const newStatus = !currentStatus;
      const response = await adminVendorService.toggleStatus(vendorId, newStatus);
      if (response.success) {
        setVendors(prev => prev.map(v =>
          v.id === vendorId ? { ...v, isActive: newStatus } : v
        ));
        toast.success(`Vendor ${newStatus ? 'activated' : 'deactivated'} successfully`);
      } else {
        toast.error(response.message || 'Failed to update vendor status');
      }
    } catch (error) {
      console.error('Error toggling vendor status:', error);
      toast.error('Failed to update status');
    }
  };

  const handleDelete = async (vendorId) => {
    if (!window.confirm('Are you sure you want to delete this vendor? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await adminVendorService.deleteVendor(vendorId);
      if (response.success) {
        setVendors(prev => prev.filter(v => v.id !== vendorId));
        toast.success('Vendor deleted successfully');
      } else {
        toast.error(response.message || 'Failed to delete vendor');
      }
    } catch (error) {
      console.error('Error deleting vendor:', error);
      toast.error('Failed to delete vendor');
    }
  };

  const handleViewDetails = (vendor) => {
    setSelectedVendor(vendor);
    setIsViewModalOpen(true);
  };

  const getStatusBadge = (status) => {
    const styles = {
      pending: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      approved: 'bg-green-100 text-green-800 border-green-300',
      rejected: 'bg-red-100 text-red-800 border-red-300'
    };

    return (
      <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${styles[status] || styles.pending}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  const pendingCount = vendors.filter(v => v.approvalStatus === 'pending').length;
  const approvedCount = vendors.filter(v => v.approvalStatus === 'approved').length;
  const rejectedCount = vendors.filter(v => v.approvalStatus === 'rejected').length;

  return (
    <div className="space-y-4">
      <CardShell
        icon={FiFilter}
        title="Vendor Management"
        subtitle="Manage and verify platform vendors"
      >
        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3">
            <div className="text-[10px] font-bold text-yellow-700 uppercase tracking-wider mb-1">Pending</div>
            <div className="text-xl font-bold text-yellow-900">{pendingCount}</div>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-xl p-3">
            <div className="text-[10px] font-bold text-green-700 uppercase tracking-wider mb-1">Approved</div>
            <div className="text-xl font-bold text-green-900">{approvedCount}</div>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-xl p-3">
            <div className="text-[10px] font-bold text-red-700 uppercase tracking-wider mb-1">Rejected</div>
            <div className="text-xl font-bold text-red-900">{rejectedCount}</div>
          </div>
        </div>

        {/* Search and Filter */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search vendors..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all text-xs"
            />
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            {['all', 'pending', 'approved', 'rejected'].map((status) => (
              <button
                key={status}
                onClick={() => setFilterStatus(status)}
                className={`px-3 py-2 rounded-lg text-xs font-bold capitalize transition-all whitespace-nowrap ${filterStatus === status
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Vendor Details</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Business Info</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  <tr>
                    <td colSpan="4" className="px-4 py-8 text-center text-xs text-gray-500">Loading vendors...</td>
                  </tr>
                ) : filteredVendors.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="px-4 py-8 text-center text-xs text-gray-500">No vendors found</td>
                  </tr>
                ) : (
                  filteredVendors.map((vendor) => (
                    <tr key={vendor.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-bold text-gray-900 text-xs">{vendor.name}</p>
                          <p className="text-[10px] text-gray-500">{vendor.phone}</p>
                          <p className="text-[10px] text-gray-400">{vendor.email}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-bold text-gray-800 text-xs">{vendor.businessName || 'N/A'}</p>
                          <p className="text-[10px] text-blue-600 font-medium">
                            {Array.isArray(vendor.service) ? vendor.service.join(', ') : (vendor.service || 'No service')}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${vendor.approvalStatus === 'approved' ? 'bg-green-50 text-green-700 border-green-100' :
                          vendor.approvalStatus === 'rejected' ? 'bg-red-50 text-red-700 border-red-100' :
                            'bg-yellow-50 text-yellow-700 border-yellow-100'
                          }`}>
                          {vendor.approvalStatus}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {/* View Details */}
                          <button
                            onClick={() => handleViewDetails(vendor)}
                            className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                            title="View Details"
                          >
                            <FiEye className="w-3.5 h-3.5" />
                          </button>

                          {/* Toggle Active Status */}
                          <button
                            onClick={() => handleToggleStatus(vendor.id, vendor.isActive)}
                            className={`p-1.5 rounded-lg transition-colors ${vendor.isActive ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'}`}
                            title={vendor.isActive ? "Disable Login" : "Enable Login"}
                          >
                            <FiPower className={`w-3.5 h-3.5 ${vendor.isActive ? 'fill-current' : ''}`} />
                          </button>

                          {/* Approve/Reject (Only for pending) */}
                          {vendor.approvalStatus === 'pending' && (
                            <>
                              <button
                                onClick={() => handleApprove(vendor.id)}
                                className="p-1.5 text-green-500 hover:bg-green-50 rounded-lg transition-colors"
                                title="Approve"
                              >
                                <FiCheck className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleReject(vendor.id)}
                                className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                title="Reject"
                              >
                                <FiX className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}

                          {/* Delete Vendor */}
                          <button
                            onClick={() => handleDelete(vendor.id)}
                            className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                            title="Delete Vendor"
                          >
                            <FiTrash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </CardShell >

      {/* View Vendor Details Modal */}
      < Modal
        isOpen={isViewModalOpen}
        onClose={() => {
          setIsViewModalOpen(false);
          setSelectedVendor(null);
        }}
        title="Vendor Details"
        size="lg"
      >
        {selectedVendor && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Business Name</label>
                <div className="text-gray-900">{selectedVendor.businessName || 'N/A'}</div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Owner Name</label>
                <div className="text-gray-900">{selectedVendor.name}</div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Email</label>
                <div className="text-gray-900">{selectedVendor.email}</div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Phone</label>
                <div className="text-gray-900">{selectedVendor.phone}</div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Service Category</label>
                <div className="text-gray-900">
                  {Array.isArray(selectedVendor.service) ? selectedVendor.service.join(', ') : (selectedVendor.service || 'N/A')}
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Status</label>
                <div>{getStatusBadge(selectedVendor.approvalStatus)}</div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Registered On</label>
                <div className="text-gray-900">
                  {new Date(selectedVendor.createdAt).toLocaleDateString()}
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Active</label>
                <div className={`text-sm font-semibold ${selectedVendor.isActive ? 'text-green-600' : 'text-red-600'}`}>
                  {selectedVendor.isActive ? 'Active' : 'Inactive'}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-3">Verification Documents</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {selectedVendor.documents.aadhar && (
                  <div>
                    <label className="block text-xs text-gray-600 mb-2">Aadhar Front</label>
                    <img
                      src={selectedVendor.documents.aadhar}
                      alt="Aadhar Front"
                      className="w-full h-48 object-cover rounded-lg border-2 border-gray-200"
                    />
                    <a
                      href={selectedVendor.documents.aadhar}
                      download
                      className="mt-2 inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700"
                    >
                      <FiDownload className="w-4 h-4" />
                      Download
                    </a>
                  </div>
                )}
                {selectedVendor.documents.aadharBack && (
                  <div>
                    <label className="block text-xs text-gray-600 mb-2">Aadhar Back</label>
                    <img
                      src={selectedVendor.documents.aadharBack}
                      alt="Aadhar Back"
                      className="w-full h-48 object-cover rounded-lg border-2 border-gray-200"
                    />
                    <a
                      href={selectedVendor.documents.aadharBack}
                      download
                      className="mt-2 inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700"
                    >
                      <FiDownload className="w-4 h-4" />
                      Download
                    </a>
                  </div>
                )}
                {selectedVendor.documents.pan && (
                  <div>
                    <label className="block text-xs text-gray-600 mb-2">PAN Card</label>
                    <img
                      src={selectedVendor.documents.pan}
                      alt="PAN"
                      className="w-full h-48 object-cover rounded-lg border-2 border-gray-200"
                    />
                    <a
                      href={selectedVendor.documents.pan}
                      download
                      className="mt-2 inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700"
                    >
                      <FiDownload className="w-4 h-4" />
                      Download
                    </a>
                  </div>
                )}
              </div>
            </div>

            {selectedVendor.approvalStatus === 'pending' && (
              <div className="flex gap-3 pt-4 border-t border-gray-200">
                <button
                  onClick={async () => {
                    await handleApprove(selectedVendor.id);
                    setIsViewModalOpen(false);
                    setSelectedVendor(null);
                  }}
                  className="flex-1 px-4 py-3 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 transition-colors flex items-center justify-center gap-2"
                >
                  <FiCheck className="w-5 h-5" />
                  Approve Vendor
                </button>
                <button
                  onClick={async () => {
                    await handleReject(selectedVendor.id);
                    setIsViewModalOpen(false);
                    setSelectedVendor(null);
                  }}
                  className="flex-1 px-4 py-3 bg-red-600 text-white rounded-xl font-semibold hover:bg-red-700 transition-colors flex items-center justify-center gap-2"
                >
                  <FiX className="w-5 h-5" />
                  Reject Vendor
                </button>
              </div>
            )}
          </div>
        )}
      </Modal >
    </div >
  );
};

export default AllVendors;

