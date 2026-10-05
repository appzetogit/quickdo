/**
 * The starting Terms & Conditions for customers of the platform, written for
 * every service it runs: food, groceries (Quick), medicines, rides and parcels,
 * and home services.
 *
 * Seeded into Master settings -> Legal pages (platform_profile.legal.terms) by
 * scripts/seed-legal-pages.mjs, only where that page is empty; an admin edits it
 * from then on. Partners (restaurants, sellers, pharmacies, riders, drivers,
 * service professionals) sign their own agreements, set per app.
 *
 * Times and amounts that admins configure -- cancellation windows, fees,
 * refund timelines -- are referred to, not written in, so the terms cannot
 * contradict what the app actually does.
 */

const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function defaultTermsHtml({ brand = 'Quick Drop', operator = '', email = '', updated = new Date() } = {}) {
  const b = esc(brand);
  const op = esc(operator || brand);
  const date = updated.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const contactLine = email
    ? `by email at <a href="mailto:${esc(email)}">${esc(email)}</a>, or through <strong>Help &amp; Support</strong> in the app`
    : 'through <strong>Help &amp; Support</strong> in the app';

  return `
<h1>Terms &amp; Conditions</h1>
<p>Last updated: ${date}</p>

<p>These terms govern your use of the ${b} app and website (the "Platform"), operated by ${op} ("${b}", "we", "us"). By creating an account or placing an order, booking a ride or booking a service, you agree to these terms, our Privacy Policy, and the cancellation and refund policies shown in the app. If you do not agree, please do not use the Platform.</p>

<h3>1. What the Platform does</h3>
<p>${b} is a technology platform that connects you with independent restaurants, stores, pharmacies, delivery partners, drivers and service professionals ("Partners") for food delivery, groceries and daily essentials, medicines, rides and parcel delivery, and home services. Unless we say otherwise for a particular order, the Partner, not ${b}, sells the goods or provides the service and is responsible for its quality, quantity, safety, legality and any licence it needs. We facilitate the order, the payment and the delivery.</p>

<h3>2. Your account</h3>
<ul>
<li>You must be at least 18 years old and able to enter a binding contract under Indian law.</li>
<li>You sign in with your mobile number and a one-time code. Keep your phone and codes secure; you are responsible for activity on your account.</li>
<li>Give accurate details, including delivery addresses and contact numbers, and keep them up to date.</li>
<li>One account works across every service on the Platform. Do not create multiple accounts or use someone else's.</li>
</ul>

<h3>3. Orders, prices and availability</h3>
<ul>
<li>Prices, menus, stock and product details are provided by Partners and may change. What you pay is the total shown at checkout before you confirm.</li>
<li>The total may include delivery fees, a platform fee, packaging charges, surge or distance-based charges, and applicable taxes (GST), each shown separately at checkout. Any discount shown is already applied to the price you see.</li>
<li>An order is accepted only when the Partner accepts it. A Partner may decline or partly fulfil an order if an item is unavailable; you will not be charged for what is not supplied.</li>
<li>Delivery and service is available only inside the areas each Partner serves. Delivery and arrival times are estimates and can change with traffic, weather, preparation time or demand.</li>
<li>Product images are for illustration. Check labels, ingredients and allergen information yourself; ask the Partner if in doubt.</li>
</ul>

<h3>4. Medicines</h3>
<ul>
<li>Medicines are sold and dispensed by licensed pharmacies on the Platform, not by ${b}.</li>
<li>Prescription medicines are supplied only against a valid prescription from a registered medical practitioner, which the pharmacist may verify. The pharmacy may refuse or modify an order that does not meet legal requirements.</li>
<li>Information on the Platform is not medical advice. Consult a doctor before taking any medicine. Do not order medicines for resale.</li>
</ul>

<h3>5. Rides and parcel delivery</h3>
<ul>
<li>Fares shown before booking are estimates based on distance, time and demand. The final fare may change with the route taken, waiting time, stops, tolls, parking or changes you make during the trip.</li>
<li>Rides are provided by independent drivers. Wear a seatbelt or helmet where required, follow the driver's reasonable safety instructions, and do not ask a driver to break traffic laws.</li>
<li>Do not send prohibited, illegal, hazardous or dangerous goods, cash, jewellery or valuables through parcel delivery. Pack items properly and describe them accurately. The driver may refuse a package that appears unsafe or unlawful.</li>
<li>Rentals and outstation trips are subject to the package, duration and distance limits shown at booking.</li>
</ul>

<h3>6. Home services</h3>
<p>Home services are performed by independent service professionals. Provide safe access to the place of service and accurate details of the work needed. Materials, extra work or changes you ask for on site may cost more; the professional will tell you before doing them.</p>

<h3>7. Payments</h3>
<ul>
<li>You can pay by UPI, card, net banking, the ${b} wallet or, where offered, cash on delivery. Online payments are processed by our payment partner; we do not store your card or UPI details.</li>
<li>For cash on delivery, pay only the amount shown in the app.</li>
<li>If a payment fails but money leaves your account, it is reversed by your bank or credited to your wallet, usually within 5 to 7 working days.</li>
</ul>

<h3>8. Wallet</h3>
<ul>
<li>Your ${b} wallet holds refunds, top-ups, cashback and rewards, and one balance can be used across every service on the Platform.</li>
<li>The wallet balance cannot be transferred to another person or withdrawn as cash, except where the law requires a refund to your original payment method.</li>
<li>Promotional credits such as cashback and referral rewards may carry their own conditions or expiry, shown when you receive them.</li>
</ul>

<h3>9. Cancellations and refunds</h3>
<p>You can cancel within the window and on the terms shown in the app for each service. A cancellation fee may apply once a Partner has accepted, started preparing, or reached you. Refunds for cancelled, undelivered, missing, damaged or incorrect items are handled under the refund and cancellation policies shown in the app and are credited to your wallet or original payment method. Report a problem with an order through Help &amp; Support as soon as possible, ideally with photos.</p>

<h3>10. Offers, coupons and referrals</h3>
<ul>
<li>Coupons and offers have their own conditions (minimum order, validity, services and areas) and cannot be exchanged for cash.</li>
<li>Referral rewards are for genuine new customers. Self-referrals, multiple accounts or other abuse will void rewards, and we may recover rewards obtained this way.</li>
<li>We may change or withdraw an offer at any time, without affecting orders already placed.</li>
</ul>

<h3>11. Ratings and reviews</h3>
<p>Reviews must be honest and about your own experience. Do not post anything abusive, defamatory, obscene or misleading, or personal information about others. We may remove reviews that break these rules.</p>

<h3>12. Your conduct</h3>
<p>You agree not to misuse the Platform, including by: placing fake or fraudulent orders; misusing refunds, offers or cash on delivery; harassing, threatening or abusing Partners, their staff or our team; tampering with the app or accessing it by automated means; or using it for anything unlawful. We may warn, restrict, suspend or close an account that does, and cancel pending orders.</p>

<h3>13. Delivery partners and other Partners</h3>
<p>Restaurants, sellers, pharmacies, delivery partners, drivers and service professionals use the Platform under their own partner agreements, shown in their apps. For delivery partners, the Gig Worker Onboarding Agreement applies in addition to these terms.</p>

<h3>14. Intellectual property</h3>
<p>The Platform, its design, software, logos and content belong to ${b} or its licensors. Partner names, logos and menus belong to the Partners. You may use the Platform only for your personal, non-commercial use.</p>

<h3>15. Liability</h3>
<p>We work to keep the Platform accurate and available, but it is provided "as is" and may sometimes be interrupted. To the extent the law allows, ${b} is not liable for goods or services provided by Partners, for delays or failures caused by events beyond our reasonable control, or for indirect or consequential loss. Where we are liable, our liability for any order is limited to the amount you paid for that order. Nothing in these terms limits rights you have under the Consumer Protection Act, 2019 that cannot be excluded.</p>

<h3>16. Indemnity</h3>
<p>You agree to compensate ${b} for losses arising from your breach of these terms or misuse of the Platform.</p>

<h3>17. Suspension and closing your account</h3>
<p>You can delete your account at any time from the app. We may suspend or close an account that breaks these terms or the law, or to protect Partners, customers or the Platform, telling you why where we can.</p>

<h3>18. Changes to these terms</h3>
<p>We may update these terms as our services or the law change. We will post the new version here with a new date and, for significant changes, tell you in the app. Continuing to use the Platform after that means you accept the updated terms.</p>

<h3>19. Governing law and disputes</h3>
<p>These terms are governed by the laws of India. Please contact us first so we can try to resolve any issue. Disputes are subject to the jurisdiction of the courts at the place of ${b}'s registered office, without affecting your right to approach a consumer commission under the Consumer Protection Act, 2019.</p>

<h3>20. Contact and grievances</h3>
<p>For questions or complaints about an order or these terms, contact ${b} ${contactLine}. Under the Consumer Protection (E-Commerce) Rules, 2020, we acknowledge complaints within 48 hours and aim to resolve them within one month.</p>
`.trim();
}
