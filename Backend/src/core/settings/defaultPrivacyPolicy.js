/**
 * The starting Privacy Policy for the platform, written for every service it
 * runs: food, groceries (Quick), medicines, rides and parcels, and home services,
 * and for the partners on the other side of each.
 *
 * Seeded once into Master settings -> Legal pages (platform_profile.legal.privacy)
 * by scripts/seed-privacy-policy.mjs, only where that page is empty, so every app
 * shows it and an admin can edit it from then on. Nothing here names a legal
 * entity, address or grievance officer: those are the operator's to fill in, and
 * a made-up one in a public policy is worse than none.
 */

const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function defaultPrivacyPolicyHtml({ brand = 'Quick Drop', email = '', updated = new Date() } = {}) {
  const b = esc(brand);
  const date = updated.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const contactLine = email
    ? `by email at <a href="mailto:${esc(email)}">${esc(email)}</a>, or through <strong>Help &amp; Support</strong> in the app`
    : 'through <strong>Help &amp; Support</strong> in the app';

  return `
<h1>Privacy Policy</h1>
<p>Last updated: ${date}</p>

<p>${b} ("we", "us") runs one app for food delivery, groceries and daily essentials, medicines, rides and parcel delivery, and home services, and the partner apps used by restaurants, sellers, pharmacies, delivery partners, drivers and service professionals. This policy explains what personal data we collect, why, who we share it with, how long we keep it, and the choices you have. It is written to meet the Digital Personal Data Protection Act, 2023 and the Information Technology Act, 2000 and the rules under them.</p>
<p>By creating an account or using our services you consent to the processing described here. You can withdraw that consent at any time (see <em>Your rights</em>), though some services cannot work without the data they need.</p>

<h3>1. Information we collect</h3>
<p><strong>Account details.</strong> Your mobile number (verified with a one-time code), name, and optionally your email address, gender, date of birth and profile photo. One account works across every service on the app.</p>
<p><strong>Addresses and location.</strong> Delivery and pickup addresses you save, and your device's precise location while you use the app, so we can show what is available near you, check that an address is inside a service area, calculate fares and delivery fees, and let you track an order or ride live.</p>
<p><strong>Orders, rides and bookings.</strong> What you order or book, from whom, when, where it went, what you paid, ratings, reviews, cancellations and refund requests.</p>
<p><strong>Medicine orders.</strong> Prescriptions you upload and the medicines you order. We treat these as sensitive: they are shared only with the pharmacy fulfilling your order and the pharmacist who checks the prescription.</p>
<p><strong>Payments and wallet.</strong> Payments are processed by our payment partner (Razorpay). We receive the payment status, method type and a transaction reference; we never see or store your full card number, CVV, UPI PIN or net-banking password. We keep your wallet balance, top-ups, refunds, cashback and referral rewards.</p>
<p><strong>Support conversations.</strong> Messages, photos and details you send to Help &amp; Support, and our replies.</p>
<p><strong>Device and usage data.</strong> Device model, operating system, app version, IP address, a notification token so we can send you updates, crash logs, and how you use the app (screens visited, searches), used to keep the app working and improve it.</p>
<p><strong>Referrals.</strong> When you invite someone, the referral code used and the reward earned. We do not upload your contact list.</p>

<h3>2. Additional information from partners</h3>
<p>If you join as a restaurant, seller, pharmacy, delivery partner, driver or service professional, we also collect what is needed to verify you and pay you: identity and address proof (such as Aadhaar, PAN, driving licence), vehicle registration, insurance and permits, business registrations (such as FSSAI, drug licence, GSTIN), photographs, and bank account or UPI details for payouts.</p>
<p>Delivery partners and drivers share their location continuously while online and on a job, including when the app is in the background, so orders and rides can be assigned and customers can track them. Location is not collected while you are offline.</p>

<h3>3. How we use your information</h3>
<ul>
<li>To create and secure your account and verify your phone number.</li>
<li>To take, fulfil and deliver orders, rides and bookings, and to show you live status.</li>
<li>To process payments, refunds, wallet credits, cashback, referral rewards and partner payouts.</li>
<li>To check that addresses are within a service zone and calculate fees, fares and taxes.</li>
<li>To send order and ride updates, security alerts and, where you have not opted out, offers, by notification, SMS or email.</li>
<li>To answer support requests and resolve complaints and disputes.</li>
<li>To detect and prevent fraud, abuse, fake accounts and misuse of offers or referrals.</li>
<li>To keep riders, drivers, partners and customers safe, including investigating incidents.</li>
<li>To understand how the app is used and improve it.</li>
<li>To meet legal, tax, accounting and regulatory obligations.</li>
</ul>

<h3>4. Who we share it with</h3>
<p>We do not sell your personal data. We share it only as needed to provide the service:</p>
<ul>
<li><strong>The partner fulfilling your order or ride.</strong> The restaurant, seller, pharmacy or service professional sees your name, order details and, where needed, address. The delivery partner or driver sees your name, pickup and drop locations and a way to contact you. Phone numbers may be masked where supported.</li>
<li><strong>Customers you serve, if you are a partner.</strong> Your name, photo, vehicle details, rating and live location during a job.</li>
<li><strong>Service providers working for us</strong>, under contract and only for our purposes: payments (Razorpay), maps and location (Google Maps), push notifications (Firebase), SMS and email delivery, cloud hosting and storage, and image hosting.</li>
<li><strong>Authorities</strong>, when required by law, a court order or a lawful request, or when necessary to protect someone's safety or prevent fraud.</li>
<li><strong>A successor business</strong>, if we are involved in a merger, acquisition or sale of assets, under this policy's protections.</li>
</ul>

<h3>5. How long we keep it</h3>
<p>We keep your account data while your account is active. Order, payment, wallet and invoice records are kept for as long as tax and accounting laws require (generally up to 8 years). Partner verification documents are kept while you are an active partner and for a limited period afterwards to meet legal obligations and resolve disputes. Precise location history from trips is kept only as long as needed for the order or ride, support, safety and legal purposes. When data is no longer needed, we delete or anonymise it.</p>

<h3>6. Deleting your account</h3>
<p>You can delete your account from the app's profile settings, or ask us to through Help &amp; Support. Any wallet balance should be used before deletion. We delete or anonymise your personal data, except records we must keep by law (such as invoices and payment records) or to resolve an open order, refund or dispute.</p>

<h3>7. Your rights</h3>
<p>Subject to law, you can:</p>
<ul>
<li>ask what personal data we hold about you and how it is used;</li>
<li>correct or update inaccurate or incomplete data (most of it directly in the app);</li>
<li>ask us to erase data we no longer need;</li>
<li>withdraw consent, including opting out of promotional messages from settings or the unsubscribe link;</li>
<li>nominate someone to exercise these rights on your behalf in the event of death or incapacity;</li>
<li>raise a grievance with us, and if it is not resolved, with the Data Protection Board of India.</li>
</ul>
<p>Contact us ${contactLine} to exercise any of these. We will verify your identity first and respond within 30 days.</p>

<h3>8. Security</h3>
<p>Data is sent over encrypted connections (HTTPS). Access to personal data is limited to staff and partners who need it, protected by passwords and role-based permissions, and logged. Payments are handled by a PCI-DSS compliant payment partner. No system is perfectly secure; if a breach affects your data, we will notify you and the authorities as the law requires.</p>

<h3>9. Location and permissions</h3>
<p>The app asks for location, camera or photos (to upload prescriptions, documents or support photos) and notifications. You can turn any of these off in your phone's settings; features that depend on them, such as live tracking or finding nearby stores, will then not work.</p>

<h3>10. Cookies and similar technologies</h3>
<p>On our website we use cookies and browser storage to keep you signed in, remember preferences such as your location and cart, and understand how the site is used. You can clear or block cookies in your browser, but parts of the site may stop working.</p>

<h3>11. Children</h3>
<p>Our services are meant for people aged 18 and over. We do not knowingly collect data from children. If you believe a child has given us personal data, contact us and we will delete it. Some medicines require a valid prescription regardless of age.</p>

<h3>12. Links to other services</h3>
<p>The app may link to payment pages, maps or partner websites run by others. Their own privacy policies apply to what you share with them.</p>

<h3>13. Changes to this policy</h3>
<p>We may update this policy as our services or the law change. We will post the new version here with a new date and, for significant changes, tell you in the app before they take effect.</p>

<h3>14. Contact and grievances</h3>
<p>For questions, requests or complaints about your personal data, contact ${b} ${contactLine}. We acknowledge grievances within 48 hours and aim to resolve them within 30 days.</p>
`.trim();
}
