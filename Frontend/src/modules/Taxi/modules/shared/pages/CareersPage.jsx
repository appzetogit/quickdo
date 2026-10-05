import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Briefcase, Target, Award, ShieldCheck } from 'lucide-react';
import api from '../../../shared/api/axiosInstance';

const CareersPage = () => {
  const navigate = useNavigate();
  const [dynamicContent, setDynamicContent] = useState('');
  const [loading, setLoading] = useState(true);

  const defaultContent = `
    <h1>Careers at Quick Drop</h1>
    <p>Join our team and build the future of urban mobility. We are constantly looking for talented software engineers, product managers, driver relationship experts, and support specialists to join our journey.</p>
    <br/>
    <h2>Open Positions</h2>
    <ul>
      <li><strong>Senior React Developer</strong> - Frontend Architecture (Siliguri/Remote)</li>
      <li><strong>Node.js Systems Engineer</strong> - Microservices & Scaling (Siliguri/Hybrid)</li>
      <li><strong>Operations & Fleet Supervisor</strong> - Partner Relations & Growth (Siliguri/On-site)</li>
      <li><strong>Customer Experience Lead</strong> - User Hailing Support (Siliguri/On-site)</li>
    </ul>
    <br/>
    <h2>How to Apply</h2>
    <p>Please send your resume along with a brief cover letter outlining your experience and motivation to <a href="mailto:k9bharatrides@gmail.com" class="text-[#C5902A] font-bold underline">k9bharatrides@gmail.com</a>.</p>
  `;

  useEffect(() => {
    const fetchContent = async () => {
      try {
        const res = await api.get('/common/landing-page/settings');
        if (res?.success && res?.data?.pages?.careers) {
          const unescapedHtml = res.data.pages.careers
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&#x2F;/g, '/');
          setDynamicContent(unescapedHtml);
        }
      } catch (err) {
        console.error('Error fetching careers content:', err);
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
            Careers
          </span>
        </div>
      </div>

      {/* Hero Section */}
      <section className="bg-[#171717] px-6 pb-16 pt-28 text-white">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex h-18 w-18 items-center justify-center rounded-[28px] bg-[#F5D476] text-black shadow-lg shadow-black/20">
            <Briefcase size={30} />
          </div>
          <h1 className="max-w-4xl text-4xl font-black tracking-tight md:text-6xl">
            Build the Future of <span className="text-[#F5D476]">Mobility</span>
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-relaxed text-stone-300">
            Join the Quick Drop team and develop the technology, infrastructure, and relationships that power cities every day.
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

export default CareersPage;
