import type { Metadata } from "next";

import { LegalPage, LegalSection } from "@/components/legal/legal-page";
import { getStoreIdentity } from "@/features/store/identity";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Cherry Doodle collects, uses, shares, and protects your personal information.",
};

export default async function PrivacyPage() {
  const store = await getStoreIdentity();
  return (
    <LegalPage
      title="Privacy Policy"
      intro="This Privacy Policy explains what personal information Cherry Doodle collects, how we use it, who we share it with, and the choices you have. By using this website you agree to this policy."
    >
      <LegalSection heading="Information we collect">
        <p>We collect only the information needed to run the store and fulfil your orders:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Account details: your name, email address, and password (stored only as a secure hash).</li>
          <li>Order details: shipping address, phone number, and the items you purchase.</li>
          <li>Communications: messages you send us through the contact form or by email.</li>
          <li>Technical data: limited information such as a hashed IP address for security and abuse prevention.</li>
        </ul>
      </LegalSection>
      <LegalSection heading="Payment information — what we never store">
        <p>
          Payments are processed securely by <strong>Razorpay</strong>. We do <strong>not</strong>{" "}
          collect, see, or store your full card number, CVV, card PIN, UPI PIN, net-banking password,
          or any one-time password (OTP). Those credentials are entered directly with Razorpay and its
          banking partners. We only receive a payment confirmation and a payment reference from
          Razorpay.
        </p>
      </LegalSection>
      <LegalSection heading="How we use your information">
        <ul className="list-disc space-y-1 pl-5">
          <li>To create and manage your account and log you in.</li>
          <li>To process, fulfil, ship, and support your orders.</li>
          <li>To handle cancellations, returns, and refunds.</li>
          <li>To respond to your enquiries and provide customer support.</li>
          <li>To protect the store against fraud and abuse.</li>
        </ul>
      </LegalSection>
      <LegalSection heading="Who we share it with">
        <p>We share the minimum necessary information with service providers who help us operate:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Razorpay</strong> — to process payments and refunds.</li>
          <li><strong>Delhivery</strong> — our courier, to deliver your order (name, address, phone).</li>
          <li><strong>Supabase</strong> — our database, authentication, and hosting infrastructure.</li>
          <li><strong>Cloudinary</strong> — to store and deliver product and site images.</li>
        </ul>
        <p>We do not sell your personal information to anyone.</p>
      </LegalSection>
      <LegalSection heading="Data retention & security">
        <p>
          We keep your information for as long as your account is active or as needed to provide the
          service and meet legal obligations. Access is protected with encryption in transit,
          row-level access controls, and hashed credentials.
        </p>
      </LegalSection>
      <LegalSection heading="Your rights & account deletion">
        <p>
          You can permanently delete your account at any time from your Account page (&ldquo;Danger
          zone&rdquo;), which removes your profile, saved addresses, cart, and wishlist. Order records are retained for
          our business and accounting purposes, subject to any records we must retain by law.
        </p>
        <p>
          For a copy of your data, a correction request, or any other privacy request, email{" "}
          <a className="text-primary hover:underline" href={`mailto:${store.email}`}>{store.email}</a>{" "}
          and we will action your request.
        </p>
      </LegalSection>
      <LegalSection heading="Grievance Officer">
        <p>
          In accordance with the Information Technology Act, 2000 and the Consumer Protection
          (E-Commerce) Rules, 2020, the details of the Grievance Officer for Cherry Doodle are:
        </p>
        <p>
          Grievance Officer, Cherry Doodle
          <br />
          Email: <a className="text-primary hover:underline" href={`mailto:${store.email}`}>{store.email}</a>
          <br />
          Phone: <a className="text-primary hover:underline" href={`tel:${store.phone.replace(/\s+/g, "")}`}>{store.phone}</a>
          <br />
          Hours: 10:00–20:00 IST, all days.
        </p>
        <p>
          We will acknowledge your complaint within <strong>48 hours</strong> and resolve it within{" "}
          <strong>30 days</strong> of receipt.
        </p>
      </LegalSection>
      <LegalSection heading="Contact">
        <p>
          Questions about your privacy? Contact{" "}
          <a className="text-primary hover:underline" href={`mailto:${store.email}`}>{store.email}</a>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
