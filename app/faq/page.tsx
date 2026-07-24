import type { Metadata } from "next";

import { LegalPage, LegalSection } from "@/components/legal/legal-page";
import { getStoreIdentity } from "@/features/store/identity";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Answers to common questions about ordering, shipping, returns, and payments at Cherry Doodle.",
};

export default async function FaqPage() {
  const store = await getStoreIdentity();
  return (
    <LegalPage
      title="Frequently Asked Questions"
      intro="Quick answers to the questions we hear most. For anything else, just get in touch."
    >
      <LegalSection heading="Do I need an account to order?">
        <p>Yes. Purchases require a free account so you can track your orders and manage returns.</p>
      </LegalSection>
      <LegalSection heading="Where do you ship and how long does it take?">
        <p>
          We ship across India via Delhivery. Orders are dispatched within 1–2 business days and usually
          delivered within 3–7 business days. See our{" "}
          <a className="text-primary hover:underline" href="/shipping">Shipping &amp; Delivery Policy</a>.
        </p>
      </LegalSection>
      <LegalSection heading="What payment methods do you accept?">
        <p>
          We accept the payment methods supported by Razorpay, including cards, UPI, and net banking. All
          prices are in Indian Rupees (INR) and payment is fully secured by Razorpay.
        </p>
      </LegalSection>
      <LegalSection heading="Can I cancel or return my order?">
        <p>
          You can cancel any time before dispatch. Returns are accepted within 7 days only for items that
          arrived damaged, and require an unedited unboxing video sent to us on Instagram with your order
          number. See our{" "}
          <a className="text-primary hover:underline" href="/refund">Cancellation &amp; Refund Policy</a>.
        </p>
      </LegalSection>
      <LegalSection heading="How do refunds work?">
        <p>
          Approved refunds are initiated within 2 business days after we receive the returned item, back
          to your original payment method via Razorpay.
        </p>
      </LegalSection>
      <LegalSection heading="How do I contact you?">
        <p>
          Email <a className="text-primary hover:underline" href={`mailto:${store.email}`}>{store.email}</a> or
          call <a className="text-primary hover:underline" href={`tel:${store.phone.replace(/\s+/g, "")}`}>{store.phone}</a>{" "}
          between 10:00–20:00 IST, or use our <a className="text-primary hover:underline" href="/contact">contact form</a>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
