import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Calendar, User, ArrowRight } from 'lucide-react';

const BlogPage = () => {
  const navigate = useNavigate();

  const blogPosts = [
    {
      id: 1,
      title: "The Future of Urban Mobility in 2026",
      excerpt: "Discover how smart city initiatives and electric vehicles are reshaping the way we commute daily.",
      author: "Admin",
      date: "April 28, 2026",
      category: "Technology",
      image: "https://images.unsplash.com/photo-1519003300449-424ad0405076?auto=format&fit=crop&w=800&q=80"
    },
    {
      id: 2,
      title: "5 Tips for a Safe and Comfortable Ride",
      excerpt: "Safety is our priority. Here are some essential tips every rider should know before booking their next trip.",
      author: "Safety Team",
      date: "April 25, 2026",
      category: "Tips & Guides",
      image: "https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?auto=format&fit=crop&w=800&q=80"
    },
    {
      id: 3,
      title: "Why Parcel Delivery is Faster with Quick Drop",
      excerpt: "We've optimized our routing algorithms to ensure your packages arrive faster and safer than ever before.",
      author: "Logistics",
      date: "April 20, 2026",
      category: "Services",
      image: "https://images.unsplash.com/photo-1580674285054-bed31e145f59?auto=format&fit=crop&w=800&q=80"
    }
  ];

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900">
      {/* Header */}
      <div className="fixed top-0 left-0 right-0 bg-white/90 backdrop-blur-md z-50 border-b border-gray-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center gap-4">
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-full transition-all">
              <ArrowLeft size={20} />
            </button>
            <span className="font-bold text-sm uppercase tracking-widest text-gray-800">Our Blog</span>
        </div>
      </div>

      {/* Hero Section */}
      <div className="bg-[#1a1a1a] text-white pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
            <h1 className="text-5xl md:text-6xl font-black tracking-tight mb-6">
                Latest <span className="text-[#FFB300]">News & Articles</span>
            </h1>
            <p className="text-xl text-gray-400 leading-relaxed max-w-2xl mx-auto">
                Stay updated with the latest trends in transportation, company news, and helpful guides.
            </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-6 py-20">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {blogPosts.map((post) => (
                <div key={post.id} className="bg-white rounded-3xl overflow-hidden shadow-sm border border-gray-100 group hover:shadow-xl hover:-translate-y-2 transition-all duration-300 flex flex-col">
                    <div className="relative h-56 overflow-hidden">
                        <img 
                            src={post.image} 
                            alt={post.title} 
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                        <div className="absolute top-4 right-4 bg-[#FFB300] text-[#1a1a1a] text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide">
                            {post.category}
                        </div>
                    </div>
                    <div className="p-8 flex flex-col flex-1">
                        <div className="flex items-center gap-4 text-sm text-gray-500 mb-4">
                            <span className="flex items-center gap-1"><Calendar size={14} /> {post.date}</span>
                            <span className="flex items-center gap-1"><User size={14} /> {post.author}</span>
                        </div>
                        <h3 className="font-bold text-2xl mb-3 leading-snug group-hover:text-[#FFB300] transition-colors">{post.title}</h3>
                        <p className="text-gray-500 leading-relaxed mb-6 flex-1">{post.excerpt}</p>
                        <button className="flex items-center gap-2 text-sm font-bold text-[#1a1a1a] group-hover:text-[#FFB300] transition-colors mt-auto">
                            Read Article <ArrowRight size={16} />
                        </button>
                    </div>
                </div>
            ))}
        </div>
      </div>
    </div>
  );
};

export default BlogPage;
