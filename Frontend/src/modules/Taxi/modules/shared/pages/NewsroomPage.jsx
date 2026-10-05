import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Globe } from 'lucide-react';
import api from '../../../shared/api/axiosInstance';

const NewsroomPage = () => {
  const navigate = useNavigate();
  const [dynamicContent, setDynamicContent] = useState('');
  const [loading, setLoading] = useState(true);

  const defaultContent = `
    <h1>Quick Drop Newsroom</h1>
    <p>Stay updated with our latest press releases, company announcements, service launches, and regulatory breakthroughs. Quick Drop is growing quickly to serve more cities across Bharat.</p>
    <br/>
    <h2>Recent Announcements</h2>
    <ul>
      <li><strong>June 2026</strong> - Quick Drop launches hourly rentals service in major commercial centers.</li>
      <li><strong>April 2026</strong> - Quick Drop crosses 10,000 active partner rides across operating hubs.</li>
      <li><strong>January 2026</strong> - Super-app platform launch and rollout in Siliguri, West Bengal.</li>
    </ul>
    <br/>
    <h2>Media Contact</h2>
    <p>For press inquiries, assets, and interview requests, please contact our media team at <a href="mailto:k9bharatrides@gmail.com" class="text-[#C5902A] font-bold underline">k9bharatrides@gmail.com</a>.</p>
  `;

  useEffect(() => {
    const fetchContent = async () => {
      try {
        const res = await api.get('/common/landing-page/settings');
        if (res?.success && res?.data?.pages?.newsroom) {
          const unescapedHtml = res.data.pages.newsroom
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&#x2F;/g, '/');
          setDynamicContent(unescapedHtml);
        }
      } catch (err) {
        console.error('Error fetching newsroom content:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchContent();
  }, []);

  return (
    <div className="min-h-screen bg-stone-50 text-slate-900">
      {/* Header */}
      <div className="fixed top-0 left-0 right-0 z-50 border-b border-stone-200 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-6">
          <button
            onClick={() => navigate(-1)}
            className="rounded-full p-2 transition-all hover:bg-stone-100"
          >
            <ArrowLeft size={20} />
          </button>
          <span className="text-sm font-bold uppercase tracking-[0.3em] text-stone-500">
            Newsroom
          </span>
        </div>
      </div>

      {/* Hero Section */}
      <section className="bg-[#171717] px-6 pb-16 pt-28 text-white">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex h-18 w-18 items-center justify-center rounded-[28px] bg-[#F5D476] text-black shadow-lg shadow-black/20">
            <Globe size={30} />
          </div>
          <h1 className="max-w-4xl text-4xl font-black tracking-tight md:text-6xl">
            Latest from <span className="text-[#F5D476]">Quick Drop</span>
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-relaxed text-stone-300">
            Explore recent updates, service rollouts, and announcements from the Quick Drop super-app platform.
          </p>
        </div>
      </section>

      {/* Main Content */}
      <section className="px-6 py-16">
        <div className="mx-auto max-w-6xl">
          <div 
            className="rounded-[28px] border border-stone-200 bg-white p-8 md:p-12 shadow-sm text-slate-700 leading-relaxed [&_h1]:text-2xl [&_h1]:font-black [&_h1]:mb-4 [&_h1]:text-slate-900 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:mb-3 [&_h2]:mt-6 [&_h2]:text-slate-900 [&_p]:text-base [&_p]:text-slate-600 [&_p]:mb-4 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-4 [&_li]:mb-2 [&_strong]:text-slate-900"
            dangerouslySetInnerHTML={{ __html: dynamicContent || defaultContent }}
          />
        </div>
      </section>
    </div>
  );
};

export default NewsroomPage;
