import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Car, Plane, MapPin, Package, Bike, HeadphonesIcon, ChevronRight } from 'lucide-react';

const ServicesPage = () => {
  const navigate = useNavigate();

  React.useEffect(() => {
    document.title = "Our Services | Quick Drop";
  }, []);

  const services = [
    { title: "City Rides", desc: "Comfortable and safe city rides to any destination.", icon: <Car className="text-[#1a1a1a]" size={28} /> },
    { title: "Airport Transfers", desc: "Punctual drops and pickups from the airport.", icon: <Plane className="text-[#1a1a1a]" size={28} /> },
    { title: "Outstation Trips", desc: "Long-distance rides for your weekend getaways.", icon: <MapPin className="text-[#1a1a1a]" size={28} /> },
    { title: "Parcel Delivery", desc: "Fast and reliable parcel delivery services.", icon: <Package className="text-[#1a1a1a]" size={28} /> },
    { title: "Bike Taxis", desc: "Beat the traffic with our quick bike taxi service.", icon: <Bike className="text-[#1a1a1a]" size={28} /> },
    { title: "24/7 Support", desc: "We are always here to help you, anytime.", icon: <HeadphonesIcon className="text-[#1a1a1a]" size={28} /> }
  ];

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900">
      {/* Header */}
      <div className="fixed top-0 left-0 right-0 bg-white/90 backdrop-blur-md z-50 border-b border-gray-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center gap-4">
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-full transition-all">
              <ArrowLeft size={20} />
            </button>
            <span className="font-bold text-sm uppercase tracking-widest text-gray-800">Our Services</span>
        </div>
      </div>

      {/* Hero Section */}
      <div className="bg-[#1a1a1a] text-white pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
            <h1 className="text-5xl md:text-6xl font-black tracking-tight mb-6">
                Premium <span className="text-[#FFB300]">Services</span>
            </h1>
            <p className="text-xl text-gray-400 leading-relaxed max-w-2xl mx-auto">
                Discover a wide range of transportation and logistics solutions tailored to meet your everyday needs.
            </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-6 py-20">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {services.map((svc, index) => (
                <div key={index} className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 group hover:shadow-xl hover:-translate-y-2 transition-all duration-300">
                    <div className="w-14 h-14 bg-[#FFB300] rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                        {svc.icon}
                    </div>
                    <h3 className="font-bold text-2xl mb-3">{svc.title}</h3>
                    <p className="text-gray-500 leading-relaxed mb-6">{svc.desc}</p>
                    <button className="flex items-center gap-2 text-sm font-bold text-[#1a1a1a] group-hover:text-[#FFB300] transition-colors">
                        Learn More <ChevronRight size={16} />
                    </button>
                </div>
            ))}
        </div>
      </div>
    </div>
  );
};

export default ServicesPage;
