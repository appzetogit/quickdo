import React, { useEffect, useState } from 'react';
import {
  Plus,
  ArrowLeft,
  Car,
  Info,
  Save,
  Trash2,
  Armchair,
  Grid3X3,
  RefreshCcw,
  Eye
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { adminService } from '../../services/adminService';
import toast from 'react-hot-toast';

const VEHICLE_TYPES = [
  { id: 'bike', label: 'Bike', capacity: 1, grid: [1, 1] },
  { id: 'hatchback', label: 'Hatchback', capacity: 4, grid: [3, 2] },
  { id: 'sedan', label: 'Sedan', capacity: 4, grid: [3, 2] },
  { id: 'suv', label: 'SUV', capacity: 6, grid: [4, 2] },
  { id: 'van', label: 'Van', capacity: 12, grid: [5, 3] },
  { id: 'luxury', label: 'Luxury', capacity: 4, grid: [3, 2] },
];

const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none transition-all focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50';
const labelClass = 'mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-400';

const PoolingVehicleForm = ({ mode: propMode }) => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isViewMode = propMode === 'view';
  const isEditMode = Boolean(id) && !isViewMode;
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  
  const [formData, setFormData] = useState({
    name: '',
    vehicleModel: '',
    vehicleNumber: '',
    capacity: 4,
    adminCommissionPercentage: 0,
    serviceTaxPercentage: 0,
    color: '',
    vehicleType: 'sedan',
    status: 'active',
    images: [],
    blueprint: {
      rows: 3,
      cols: 2,
      layout: [] // Array of { r, c, type: 'seat' | 'empty' | 'driver' }
    }
  });
  const generateDefaultLayout = (type) => {
    const config = VEHICLE_TYPES.find(t => t.id === type) || VEHICLE_TYPES[2];
    const rows = config.grid[0];
    const cols = config.grid[1];
    const layout = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let seatType = 'seat';
        if (r === 0 && c === 0) seatType = 'driver';
        if (r === 0 && c === 1 && type !== 'van') seatType = 'empty'; // Usually empty next to driver or for legroom
        layout.push({ r, c, type: seatType });
      }
    }

    return { rows, cols, layout };
  };

  useEffect(() => {
    if (id) {
      loadVehicle();
    } else {
      // Set default layout for Sedan
      setFormData(prev => ({
        ...prev,
        blueprint: generateDefaultLayout('sedan')
      }));
    }
  }, [id]);

  const loadVehicle = async () => {
    setLoading(true);
    try {
      const response = await adminService.getPoolingVehicles();
      const vehicle = response.data.find(v => v._id === id);
      if (vehicle) {
        setFormData({
          name: vehicle.name || '',
          vehicleModel: vehicle.vehicleModel || '',
          vehicleNumber: vehicle.vehicleNumber || '',
          capacity: vehicle.capacity || 4,
          adminCommissionPercentage: Number(vehicle.adminCommissionPercentage ?? 0),
          serviceTaxPercentage: Number(vehicle.serviceTaxPercentage ?? 0),
          color: vehicle.color || '',
          vehicleType: vehicle.vehicleType || 'sedan',
          status: vehicle.status || 'active',
          images: vehicle.images || [],
          blueprint: vehicle.blueprint || generateDefaultLayout(vehicle.vehicleType || 'sedan')
        });
      }
    } catch (error) {
      toast.error('Failed to load vehicle data');
    } finally {
      setLoading(false);
    }
  };

  const removeImage = (index) => {
    setFormData(prev => ({
      ...prev,
      images: prev.images.filter((_, i) => i !== index)
    }));
  };

  const handleTypeChange = (type) => {
    if (isViewMode) return;
    setFormData(prev => ({
      ...prev,
      vehicleType: type,
      blueprint: generateDefaultLayout(type)
    }));
  };

  const toggleSeat = (r, c) => {
    if (isViewMode) return;
    const layout = [...formData.blueprint.layout];
    const index = layout.findIndex(s => s.r === r && s.c === c);
    if (index === -1) return;

    const currentType = layout[index].type;
    let nextType = 'seat';
    if (currentType === 'seat') nextType = 'empty';
    else if (currentType === 'empty') nextType = 'driver';
    else if (currentType === 'driver') nextType = 'seat';

    layout[index].type = nextType;
    
    // Auto-update capacity based on 'seat' count
    const seatCount = layout.filter(s => s.type === 'seat').length;

    setFormData(prev => ({
      ...prev,
      capacity: seatCount,
      blueprint: { ...prev.blueprint, layout }
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isViewMode) return;
    setSaving(true);
    try {
      const payload = {
        ...formData,
        adminCommissionPercentage: Math.min(100, Math.max(0, Number(formData.adminCommissionPercentage || 0))),
        serviceTaxPercentage: Math.min(100, Math.max(0, Number(formData.serviceTaxPercentage || 0))),
      };

      if (isEditMode) {
        await adminService.updatePoolingVehicle(id, payload);
        toast.success('Vehicle updated successfully');
      } else {
        await adminService.createPoolingVehicle(payload);
        toast.success('Vehicle created successfully');
      }
      navigate('/taxi/admin/pooling/vehicles');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50/50 p-6 lg:p-8">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => navigate('/taxi/admin/pooling/vehicles')}
            className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-400 transition hover:text-slate-900"
          >
            <ArrowLeft size={16} />
            Back to Fleet
          </button>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-black text-slate-900">
                {isViewMode ? 'View Vehicle' : isEditMode ? 'Edit Vehicle' : 'Add New Vehicle'}
              </h1>
              <p className="text-sm font-medium text-slate-500">
                {isViewMode ? 'Review vehicle details and seat layout blueprint' : 'Configure vehicle details and seat layout blueprint'}
              </p>
            </div>
            {isViewMode ? (
              <button
                onClick={() => navigate(`/taxi/admin/pooling/vehicles/edit/${id}`)}
                className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-6 py-3 text-sm font-black text-white shadow-xl shadow-indigo-200 transition-all hover:bg-indigo-700 active:scale-95"
              >
                <Save size={18} />
                Edit Vehicle
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-6 py-3 text-sm font-black text-white shadow-xl shadow-indigo-200 transition-all hover:bg-indigo-700 active:scale-95 disabled:opacity-50"
              >
                {saving ? <RefreshCcw size={18} className="animate-spin" /> : <Save size={18} />}
                {isEditMode ? 'Save Changes' : 'Create Vehicle'}
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-5">
          {/* Form Side */}
          <div className="lg:col-span-2 space-y-6">
            <div className="rounded-[32px] border border-slate-100 bg-white p-8 shadow-sm">
              <h3 className="mb-6 text-lg font-black text-slate-900">Basic Information</h3>
              <div className="space-y-4">
                <div>
                  <label className={labelClass}>Vehicle Type</label>
                  <div className="grid grid-cols-3 gap-2">
                    {VEHICLE_TYPES.map(type => (
                      <button
                        key={type.id}
                        type="button"
                        onClick={() => handleTypeChange(type.id)}
                        disabled={isViewMode}
                        className={`rounded-xl border p-3 text-center transition-all ${
                          formData.vehicleType === type.id
                            ? 'border-indigo-600 bg-indigo-50 text-indigo-600'
                            : 'border-slate-100 bg-slate-50 text-slate-400 hover:border-slate-200'
                        } ${isViewMode ? 'cursor-default opacity-80' : ''}`}
                      >
                        <p className="text-[10px] font-black uppercase tracking-tight">{type.label}</p>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Vehicle Name</label>
                  <input
                    required
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    placeholder="e.g. Toyota Camry"
                    className={inputClass}
                    readOnly={isViewMode}
                  />
                </div>
                <div>
                  <label className={labelClass}>Model / Year</label>
                  <input
                    required
                    type="text"
                    value={formData.vehicleModel}
                    onChange={(e) => setFormData({...formData, vehicleModel: e.target.value})}
                    placeholder="e.g. Hybrid 2024"
                    className={inputClass}
                    readOnly={isViewMode}
                  />
                </div>
                <div>
                  <label className={labelClass}>Number Plate</label>
                  <input
                    required
                    type="text"
                    value={formData.vehicleNumber}
                    onChange={(e) => setFormData({...formData, vehicleNumber: e.target.value})}
                    placeholder="e.g. MP09-AB-1234"
                    className={inputClass}
                    readOnly={isViewMode}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>Capacity</label>
                    <div className="flex h-11 items-center justify-center rounded-xl bg-slate-100 font-black text-slate-900">
                      {formData.capacity} Seats
                    </div>
                  </div>
                  <div>
                    <label className={labelClass}>Color</label>
                    <input
                      type="text"
                      value={formData.color}
                      onChange={(e) => setFormData({...formData, color: e.target.value})}
                      placeholder="e.g. Black"
                      className={inputClass}
                      readOnly={isViewMode}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelClass}>Admin Commission %</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={formData.adminCommissionPercentage}
                      onChange={(e) => setFormData({ ...formData, adminCommissionPercentage: e.target.value })}
                      placeholder="e.g. 12.5"
                      className={inputClass}
                      readOnly={isViewMode}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Service Tax %</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={formData.serviceTaxPercentage}
                      onChange={(e) => setFormData({ ...formData, serviceTaxPercentage: e.target.value })}
                      placeholder="e.g. 5"
                      className={inputClass}
                      readOnly={isViewMode}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[32px] border border-slate-100 bg-white p-8 shadow-sm">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-black text-slate-900">Vehicle Images</h3>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    {isViewMode ? 'Vehicle photo gallery' : 'Add multiple photos of the vehicle'}
                  </p>
                </div>
                {isViewMode ? (
                  <div className="inline-flex items-center gap-2 rounded-xl bg-slate-50 px-4 py-2 text-xs font-black uppercase tracking-wide text-slate-500">
                    <Eye size={14} />
                    Read Only
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={async (e) => {
                        const file = e.target.files[0];
                        if (!file) return;
                        
                        const reader = new FileReader();
                        reader.onloadend = async () => {
                          const base64 = reader.result;
                          const loadingToast = toast.loading('Uploading image...');
                          try {
                            const res = await adminService.uploadImage(base64);
                            setFormData(prev => ({
                              ...prev,
                              images: [...prev.images, res.data.url]
                            }));
                            toast.success('Image uploaded', { id: loadingToast });
                          } catch (error) {
                            toast.error('Upload failed', { id: loadingToast });
                          }
                        };
                        reader.readAsDataURL(file);
                      }}
                      className="absolute inset-0 cursor-pointer opacity-0"
                      id="vehicle-image-upload"
                    />
                    <label 
                      htmlFor="vehicle-image-upload"
                      className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-indigo-50 px-4 py-2 text-xs font-black uppercase tracking-wide text-indigo-600 transition hover:bg-indigo-100"
                    >
                      <Plus size={16} />
                      Upload Image
                    </label>
                  </div>
                )}
              </div>
              
              <div className="grid grid-cols-3 gap-3">
                {formData.images.map((img, idx) => (
                  <div key={idx} className="group relative aspect-square overflow-hidden rounded-2xl bg-slate-100 border border-slate-200 shadow-sm">
                    <img src={img} alt="" className="h-full w-full object-cover" />
                    {!isViewMode ? (
                      <button
                        type="button"
                        onClick={() => removeImage(idx)}
                        className="absolute right-2 top-2 rounded-lg bg-rose-500 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100 shadow-lg"
                      >
                        <Trash2 size={12} />
                      </button>
                    ) : null}
                  </div>
                ))}
                {formData.images.length === 0 && (
                  <div className="col-span-3 flex h-32 flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-100 bg-slate-50/50 text-slate-300">
                    <Car size={24} strokeWidth={1} className="mb-2" />
                    <p className="text-[10px] font-black uppercase tracking-widest">No images uploaded</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Blueprint Side */}
          <div className="lg:col-span-3 space-y-6">
            <div className="rounded-[32px] border border-slate-100 bg-white p-8 shadow-sm">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-black text-slate-900">Seat Layout Blueprint</h3>
                  <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Interactive Top View Design</p>
                </div>
                <div className="flex gap-2">
                  <div className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1">
                    <div className="h-2 w-2 rounded-full bg-indigo-500" />
                    <span className="text-[10px] font-black uppercase text-slate-500">Seat</span>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1">
                    <div className="h-2 w-2 rounded-full bg-slate-900" />
                    <span className="text-[10px] font-black uppercase text-slate-500">Driver</span>
                  </div>
                </div>
              </div>

              {/* Top View Container */}
              <div className="flex flex-col items-center justify-center py-12 bg-slate-50/50 rounded-[40px] border border-dashed border-slate-200">
                {/* Windshield */}
                <div className="mb-8 h-12 w-48 rounded-t-[60px] border-x-8 border-t-8 border-slate-300 bg-slate-200/50" />
                
                {/* Grid */}
                <div className="relative p-6 rounded-[48px] bg-white shadow-2xl border-x-12 border-slate-300">
                  <div 
                    className="grid gap-6"
                    style={{ 
                      gridTemplateColumns: `repeat(${formData.blueprint.cols}, minmax(0, 1fr))`,
                      gridTemplateRows: `repeat(${formData.blueprint.rows}, minmax(0, 1fr))`
                    }}
                  >
                    {formData.blueprint.layout.map((item) => (
                      <button
                        key={`${item.r}-${item.c}`}
                        type="button"
                        onClick={() => toggleSeat(item.r, item.c)}
                        disabled={isViewMode}
                        className={`group relative h-16 w-16 flex items-center justify-center rounded-2xl transition-all ${
                          item.type === 'seat' 
                            ? 'bg-indigo-50 text-indigo-600 border-2 border-indigo-200 hover:bg-indigo-600 hover:text-white' 
                            : item.type === 'driver'
                            ? 'bg-slate-900 text-white border-2 border-slate-900 cursor-default'
                            : 'bg-slate-100 text-slate-300 border-2 border-dashed border-slate-200 hover:bg-slate-200'
                        } ${isViewMode ? 'cursor-default' : ''}`}
                      >
                        {item.type === 'seat' && <Armchair size={24} />}
                        {item.type === 'driver' && <Grid3X3 size={24} />}
                        {item.type === 'empty' && <div className="h-2 w-2 rounded-full bg-slate-300" />}
                        
                        {/* Tooltip */}
                        <span className="absolute -top-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-800 text-white text-[9px] font-black px-2 py-1 rounded uppercase tracking-tighter">
                          {item.type}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Trunk */}
                <div className="mt-8 h-8 w-48 rounded-b-3xl border-x-8 border-b-8 border-slate-300 bg-slate-200/50" />
              </div>

              <div className="mt-8 rounded-2xl bg-amber-50 p-4 border border-amber-100">
                <div className="flex gap-3">
                  <Info className="text-amber-500 shrink-0" size={20} />
                  <p className="text-xs font-medium text-amber-700 leading-relaxed">
                    <strong>{isViewMode ? 'Layout Preview:' : 'Design Instructions:'}</strong>{' '}
                    {isViewMode
                      ? 'This seating blueprint is shown in read-only mode so you can review how the pooling vehicle is configured.'
                      : 'Click on any block to cycle through Seat, Empty Space, or Driver. The capacity is automatically calculated based on the number of active seats.'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PoolingVehicleForm;
