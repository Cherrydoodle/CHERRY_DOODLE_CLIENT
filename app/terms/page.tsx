import type { Metadata } from "next";

import { LegalPage, LegalSection } from "@/components/legal/legal-page";
import { getStoreIdentity } from "@/features/store/identity";

export const metadata: Metadata = {
  title: "Terms & Conditions",
  description: "The terms governing your use of the Cherry Doodle website and purchases.",
};

export default async function TermsPage() {
  const store = await getStoreIdentity();
  return (
    <LegalPage
      title="Terms & Conditions"
      intro="These Terms & Conditions govern your access to and use of the Cherry Doodle website and your purchase of products from us. By using this site or placing an order, you agree to these terms."
    >
      <LegalSection heading="1. Who we are">
        <p>
          Cherry Doodle is an online stationery store operated as an individual proprietorship based in
          India. Contact: {store.email}, {store.phone}.
        </p>
      </LegalSection>
      <LegalSection heading="2. Eligibility & accounts">
        <p>
          You must be able to form a legally binding contract to purchase from us. Purchases require a
          registered account and login. You are responsible for keeping your login credentials secure
          and for activity under your account.
        </p>
      </LegalSection>
      <LegalSection heading="3. Orders & acceptance">
        <p>
          Placing an order is an offer to buy. A contract forms only once payment is successfully
          captured and we confirm the order. We may decline or cancel an order — for example, if an item
          is unavailable or priced in error — and in that case any amount charged is refunded.
        </p>
      </LegalSection>
      <LegalSection heading="4. Pricing & payment">
        <p>
          All prices are listed in Indian Rupees (INR). The price and any shipping charge shown at
          checkout is the amount you pay. Payments are processed securely through Razorpay; we never
          store your card, UPI, or banking credentials (see our Privacy Policy).
        </p>
      </LegalSection>
      <LegalSection heading="5. Taxes">
        <p>
          Cherry Doodle is not currently registered under GST. Prices shown are the final prices payable
          and no separate GST is charged.
        </p>
      </LegalSection>
      <LegalSection heading="6. Availability">
        <p>
          Products are subject to availability. Where an item becomes unavailable after you order, we
          will notify you and refund the affected amount.
        </p>
      </LegalSection>
      <LegalSection heading="7. Cancellation, delivery, returns & refunds">
        <p>
          Delivery is covered by our <a className="text-primary hover:underline" href="/shipping">Shipping &amp; Delivery Policy</a>.
          Cancellations, returns, and refunds are covered by our{" "}
          <a className="text-primary hover:underline" href="/refund">Cancellation &amp; Refund Policy</a>. Those policies form part of these terms.
        </p>
      </LegalSection>
      <LegalSection heading="8. Acceptable use">
        <p>
          You agree not to misuse the site — including attempting to disrupt it, access it without
          authorisation, or use it for any unlawful or fraudulent purpose.
        </p>
      </LegalSection>
      <LegalSection heading="9. Intellectual property">
        <p>
          All content on this site — including the Cherry Doodle name, logo, images, and text — is owned
          by or licensed to us and may not be copied or reused without permission.
        </p>
      </LegalSection>
      <LegalSection heading="10. Limitation of liability">
        <p>
          To the maximum extent permitted by law, Cherry Doodle is not liable for indirect or
          consequential losses. Nothing in these terms excludes liability that cannot be excluded under
          applicable law.
        </p>
      </LegalSection>
      <LegalSection heading="11. Governing law & jurisdiction">
        <p>
          These terms are governed by the laws of India, and the courts of India have exclusive
          jurisdiction over any dispute.
        </p>
      </LegalSection>
      <LegalSection heading="12. Grievance redressal">
        <p>
          In accordance with the Information Technology Act, 2000 and the Consumer Protection
          (E-Commerce) Rules, 2020, complaints or concerns regarding any order or content on this site
          may be directed to our Grievance Officer at{" "}
          <a className="text-primary hover:underline" href={`mailto:${store.email}`}>{store.email}</a> or{" "}
          <a className="text-primary hover:underline" href={`tel:${store.phone.replace(/\s+/g, "")}`}>{store.phone}</a>.
          We will acknowledge your complaint within 48 hours and resolve it within 30 days of receipt.
        </p>
      </LegalSection>
      <LegalSection heading="13. Contact">
        <p>
          Questions about these terms? Contact{" "}
          <a className="text-primary hover:underline" href={`mailto:${store.email}`}>{store.email}</a>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
