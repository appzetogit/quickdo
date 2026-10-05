import React, { useState, useEffect } from 'react';
import { ArrowLeft, FileText, IndianRupee, ReceiptText, Scale, ScrollText, ShieldCheck } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../../../shared/api/axiosInstance';
import { API_BASE_URL } from '../../../shared/api/runtimeConfig';

// Terms and privacy written for the taxi rider or driver app (admin: Master settings, App terms).
const fetchAppLegal = async (app, kind) => {
  try {
    const base = String(API_BASE_URL).replace(/\/taxi\/?$/, '');
    const res = await fetch(`${base}/platform/legal/${app}/${kind}`);
    const body = await res.json();
    return body?.data?.content || '';
  } catch {
    return '';
  }
};

const vehiclePricing = [
  { type: 'Bike', capacity: 'Up to 2 riders', price: 'Starts at Rs 49', cancellationCut: 'Admin cut up to Rs 10', note: 'Best for quick solo rides and short-distance travel.' },
  { type: 'Auto', capacity: 'Up to 3 riders', price: 'Starts at Rs 79', cancellationCut: 'Admin cut up to Rs 15', note: 'Suitable for city commutes and local market travel.' },
  { type: 'Taxi', capacity: 'Up to 4 riders', price: 'Starts at Rs 129', cancellationCut: 'Admin cut up to Rs 25', note: 'Standard cab option for everyday point-to-point trips.' },
  { type: 'Premium Car', capacity: 'Up to 7 riders', price: 'Starts at Rs 249', cancellationCut: 'Admin cut up to Rs 40', note: 'Extra comfort and larger seating for family or business travel.' },
  { type: 'eRickshaw', capacity: 'Up to 3 riders', price: 'Starts at Rs 69', cancellationCut: 'Admin cut up to Rs 12', note: 'May be available in selected operating zones only.' },
];

const legalContent = {
  terms: {
    label: 'Terms & Conditions',
    title: 'Terms & Conditions',
    icon: ScrollText,
    intro:
      'These Terms & Conditions govern the use of the Quick Drop website, app, and booking services. By using the platform, you agree to follow these terms whenever you browse, register, book, cancel, or pay for a service.',
    sections: [
      {
        title: 'Use of the platform',
        body:
          'Quick Drop provides technology services for ride booking, vehicle-based transport support, parcel movement, and related mobility services. Availability can vary by city, vehicle type, demand, operating hours, and serviceability.',
      },
      {
        title: 'Eligibility',
        bullets: [
          'Users should provide accurate name, phone number, and account details.',
          'You must use the platform only for lawful purposes.',
          'For rentals or regulated vehicle services, additional identity or eligibility checks may be required.',
        ],
      },
      {
        title: 'Bookings and fares',
        bullets: [
          'A booking is confirmed only after the system accepts it and a driver, partner, or service unit is assigned when required.',
          'Displayed fares can change because of distance, traffic, tolls, waiting time, service zone, taxes, or peak demand.',
          'Final payable amounts shown at checkout or after trip completion are considered binding unless there is a verified billing error.',
        ],
      },
      {
        title: 'User responsibilities',
        bullets: [
          'Do not create fake bookings or misuse payment methods.',
          'Do not damage vehicles, partner property, or equipment.',
          'Do not harass drivers, delivery partners, service staff, or support teams.',
          'Do not use the service for illegal, dangerous, or prohibited goods or activities.',
        ],
      },
      {
        title: 'Account actions',
        body:
          'Quick Drop may suspend, restrict, or terminate access where there is fraud, abusive conduct, repeated policy violations, non-payment, chargeback misuse, or legal/regulatory risk.',
      },
      {
        title: 'Liability and service interruptions',
        body:
          'Quick Drop works to keep the service reliable, but delays may happen because of traffic, weather, technical downtime, route closures, law-and-order issues, or third-party failures. To the extent permitted by law, Quick Drop is not responsible for indirect or consequential loss arising from such interruptions.',
      },
      {
        title: 'Contact',
        body:
          'For questions about these terms, users can contact the support team through the contact details listed on the website.',
      },
    ],
  },
  privacy: {
    label: 'Privacy Policy',
    title: 'Privacy Policy',
    icon: ShieldCheck,
    intro:
      'This website is managed by Quick Drop. This Privacy Policy explains what information we collect, why we collect it, how we use it, and the steps we take to protect it when you use the Quick Drop website or connected services.',
    sections: [
      {
        title: 'Information we may collect',
        bullets: [
          'Name, mobile number, email address, and account profile details.',
          'Pickup and drop locations, booking history, cancellation records, and support interactions.',
          'Device, browser, IP address, app version, and diagnostic information needed for security and service quality.',
          'Location information during active rides or service requests where needed for dispatch, tracking, and safety.',
        ],
      },
      {
        title: 'How we use your information',
        bullets: [
          'To create and manage your account.',
          'To process bookings, assignments, payments, and support requests.',
          'To improve matching, service performance, fraud prevention, and safety monitoring.',
          'To send OTPs, service alerts, invoices, and important operational communication.',
        ],
      },
      {
        title: 'Sharing of information',
        body:
          'We may share limited information with drivers, delivery or service partners, payment providers, communication vendors, analytics tools, and authorities when required by law or necessary for service delivery.',
      },
      {
        title: 'Payments and data security',
        body:
          'Payments may be processed through third-party payment partners. Quick Drop does not intentionally store full card data on the website. We use reasonable administrative and technical safeguards to protect user information, but no internet-based system can be guaranteed to be fully secure.',
      },
      {
        title: 'Data retention and user rights',
        bullets: [
          'We may keep records for customer support, tax, compliance, fraud prevention, and dispute handling.',
          'Users may request correction of incorrect account information.',
          'Users may request account deletion or review of stored personal data, subject to legal and operational retention obligations.',
        ],
      },
      {
        title: 'Policy updates',
        body:
          'Quick Drop may revise this Privacy Policy from time to time. Continued use of the website after an update means you accept the revised policy.',
      },
    ],
  },
  refund: {
    label: 'Refund Policy',
    title: 'Refund & Cancellation Policy',
    icon: ReceiptText,
    intro:
      'This page explains refund eligibility, cancellation timelines, and indicative prices for the main vehicle types available on the Quick Drop platform. Refunds are reviewed based on service status, time of cancellation, and payment mode.',
    sections: [
      {
        title: 'When refunds may be approved',
        bullets: [
          'Duplicate payment or verified overcharge.',
          'Booking cancelled by the platform or partner after confirmation.',
          'Service could not be fulfilled and the customer was not at fault.',
          'Cancellation made within the free cancellation period, where applicable.',
        ],
      },
      {
        title: 'Refund policy overview',
        body:
          'Quick Drop reviews refund requests on a case-by-case basis to confirm whether the booking was completed, cancelled before service, cancelled after dispatch, or affected by a technical or payment issue. Approved refunds are returned only after internal verification of ride logs, payment status, and service records.',
      },
      {
        title: 'Cancellation rules',
        bullets: [
          'Bike and Auto bookings: free cancellation usually applies before partner assignment or within a short grace window after booking.',
          'Taxi bookings: a cancellation fee may apply once a driver is assigned, the driver is close to pickup, or the vehicle has already started toward the user.',
          'Premium Car bookings: because these block a larger-capacity vehicle, late cancellation may attract a higher convenience or blocking fee.',
          'Parcel or service-center linked vehicle bookings: once pickup, dispatch, or service preparation begins, the booking may become partially refundable or non-refundable.',
          'No-show cases, repeated misuse, or cancellations after service start are generally non-refundable.',
        ],
      },
      {
        title: 'Cases where refunds may be partial',
        bullets: [
          'If a driver or service partner has already been assigned and operational costs have started.',
          'If a vehicle was reserved for a scheduled booking and cancelled late by the customer.',
          'If waiting charges, toll blocking, convenience fees, or zone-specific service costs have already been incurred.',
          'If the service was partly delivered before the booking was cancelled or interrupted.',
        ],
      },
      {
        title: 'Cases where refunds are usually not allowed',
        bullets: [
          'Incorrect pickup or drop details entered by the user that caused service failure.',
          'Customer no-show after the partner reaches or waits at the pickup point.',
          'Cancellations made after the trip, rental, dispatch, or service has already started.',
          'Fraudulent transactions, chargeback misuse, or policy abuse under investigation.',
          'Complaints raised without enough booking or payment proof where service records show successful completion.',
        ],
      },
      {
        title: 'Refund timelines',
        bullets: [
          'UPI or wallet refunds are usually credited within 1 to 3 business days after approval.',
          'Card, bank, or gateway refunds are usually credited within 5 to 10 business days after approval.',
          'If a banking partner delays settlement, the final credit timeline may depend on the payment provider.',
        ],
      },
      {
        title: 'Refund eligibility',
        body:
          'Eligible refunds will be credited within 5 to 10 business days to the original payment method, subject to banking timelines.',
      },
      {
        title: 'How to request a refund',
        bullets: [
          'Raise the issue through the support team with your booking ID, payment details, and reason for the request.',
          'Submit the request as early as possible after the cancelled or affected booking.',
          'Quick Drop may ask for screenshots, transaction references, or additional verification before approval.',
        ],
      },
      {
        title: 'Indicative vehicle pricing',
        table: vehiclePricing,
      },
      {
        title: 'Important pricing note',
        body:
          'The prices and admin cancellation cuts listed above are indicative website references only. Actual booking fares and cancellation deductions can change based on city, route, timing, service zone, partner assignment stage, tolls, waiting time, demand, and service availability.',
      },
    ],
  },
  cancellation: {
    label: 'Cancellation Policy',
    title: 'Cancellation Policy',
    icon: Scale,
    intro:
      'This page summarizes how cancellations are handled across Quick Drop booking categories.',
    sections: [
      {
        title: 'General policy',
        bullets: [
          'Free cancellation may be available during a short grace period.',
          'Charges may apply after partner assignment, dispatch, or service start.',
          'Refundability depends on timing, service state, and payment verification.',
        ],
      },
    ],
  },
};

const getDocumentType = (pathname = '') => {
  const value = pathname.toLowerCase();
  if (value.includes('privacy-policy') || value.includes('privacy')) return 'privacy';
  if (value.includes('terms-and-conditions') || value.includes('terms')) return 'terms';
  if (value.includes('refund')) return 'refund';
  if (value.includes('cancellation')) return 'cancellation';
  return 'terms';
};

const LegalPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const docType = getDocumentType(location.pathname);
  const content = legalContent[docType];
  const Icon = content.icon || FileText;

  const [dynamicContent, setDynamicContent] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (content?.title) {
      document.title = `${content.title} | Quick Drop`;
    }
  }, [content]);

  useEffect(() => {
    const fetchContent = async () => {
      try {
        if (docType === 'terms' || docType === 'privacy') {
          const role = String(location.state?.role || '').toLowerCase();
          const isDriver = ['driver', 'owner'].includes(role) || location.pathname.includes('/driver');
          const own = await fetchAppLegal(isDriver ? 'taxi_driver' : 'taxi_user', docType);
          if (own) {
            setDynamicContent(own);
            return;
          }
        }
        const res = await api.get('/common/landing-page/settings');
        if (res?.success && res?.data) {
          let pageKey = 'terms_conditions';
          if (docType === 'privacy') pageKey = 'privacy_policy';
          if (docType === 'refund') pageKey = 'refund_policy';
          if (docType === 'cancellation') pageKey = 'cancellation_policy';
          
          if (res.data.pages?.[pageKey]) {
            const unescapedHtml = res.data.pages[pageKey]
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&amp;/g, '&')
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .replace(/&#x2F;/g, '/');
            setDynamicContent(unescapedHtml);
          }
        }
      } catch (err) {
        console.error('Error fetching legal content:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docType, location.pathname]);

  return (
    <div className="min-h-screen bg-stone-50 text-slate-900">
      <div className="fixed top-0 left-0 right-0 z-50 border-b border-stone-200 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-6">
          <button
            onClick={() => navigate(-1)}
            className="rounded-full p-2 transition-all hover:bg-stone-100"
          >
            <ArrowLeft size={20} />
          </button>
          <span className="text-sm font-bold uppercase tracking-[0.3em] text-stone-500">
            {content.label}
          </span>
        </div>
      </div>

      <section className="bg-[#171717] px-6 pb-16 pt-28 text-white">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex h-18 w-18 items-center justify-center rounded-[28px] bg-[#f4b400] text-black shadow-lg shadow-black/20">
            <Icon size={30} />
          </div>
          <h1 className="max-w-4xl text-4xl font-black tracking-tight md:text-6xl">
            {content.title}
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-relaxed text-stone-300">
            {content.intro}
          </p>
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="mx-auto max-w-6xl">
          {dynamicContent ? (
            <div 
              className="rounded-[28px] border border-stone-200 bg-white p-8 md:p-12 shadow-sm text-slate-700 leading-relaxed [&_h1]:text-2xl [&_h1]:font-black [&_h1]:mb-4 [&_h1]:text-slate-900 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:mb-3 [&_h2]:text-slate-900 [&_p]:text-base [&_p]:text-slate-600 [&_p]:mb-4 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-4 [&_li]:mb-1"
              dangerouslySetInnerHTML={{ __html: dynamicContent }}
            />
          ) : (
            <div className="space-y-8">
              {content.sections.map((section) => (
                <div key={section.title} className="rounded-[28px] border border-stone-200 bg-white p-8 shadow-sm">
                  <h2 className="text-xl font-black tracking-tight text-slate-900 md:text-2xl">
                    {section.title}
                  </h2>

                  {section.body ? (
                    <p className="mt-4 text-base leading-8 text-slate-600">{section.body}</p>
                  ) : null}

                  {section.bullets ? (
                    <ul className="mt-4 space-y-3 text-base leading-7 text-slate-600">
                      {section.bullets.map((item) => (
                        <li key={item} className="flex gap-3">
                          <span className="mt-2 h-2 w-2 rounded-full bg-[#f4b400]" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {section.table ? (
                    <div className="mt-6 overflow-hidden rounded-[24px] border border-stone-200">
                      <div className="grid grid-cols-1 gap-px bg-stone-200 md:grid-cols-5">
                        <div className="bg-stone-100 px-5 py-4 text-xs font-black uppercase tracking-[0.25em] text-stone-500">Vehicle Type</div>
                        <div className="bg-stone-100 px-5 py-4 text-xs font-black uppercase tracking-[0.25em] text-stone-500">Capacity</div>
                        <div className="bg-stone-100 px-5 py-4 text-xs font-black uppercase tracking-[0.25em] text-stone-500">Starting Price</div>
                        <div className="bg-stone-100 px-5 py-4 text-xs font-black uppercase tracking-[0.25em] text-stone-500">Cancellation Cut</div>
                        <div className="bg-stone-100 px-5 py-4 text-xs font-black uppercase tracking-[0.25em] text-stone-500">Use Case</div>
                      </div>

                      {section.table.map((row) => (
                        <div key={row.type} className="grid grid-cols-1 gap-px border-t border-stone-200 bg-stone-200 md:grid-cols-5">
                          <div className="bg-white px-5 py-5">
                            <div className="flex items-center gap-2 text-base font-bold text-slate-900">
                              <IndianRupee size={16} className="text-[#f4b400]" />
                              {row.type}
                            </div>
                          </div>
                          <div className="bg-white px-5 py-5 text-sm text-slate-600">{row.capacity}</div>
                          <div className="bg-white px-5 py-5 text-sm font-bold text-slate-900">{row.price}</div>
                          <div className="bg-white px-5 py-5 text-sm font-bold text-slate-900">{row.cancellationCut}</div>
                          <div className="bg-white px-5 py-5 text-sm text-slate-600">{row.note}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default LegalPage;
