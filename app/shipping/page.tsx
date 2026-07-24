import type { Metadata } from "next";

import { LegalPage, LegalSection } from "@/components/legal/legal-page";
import { getStoreIdentity } from "@/features/store/identity";

export const metadata: Metadata = {
  title: "Shipping & Delivery Policy",
  description: "How Cherry Doodle dispatches and delivers orders across India via Delhivery.",
};

export default async function ShippingPage() {
  const store = await getStoreIdentity();
  return (
    <LegalPage
      title="Shipping & Delivery Policy"
      intro="This policy explains how and when we dispatch and deliver your Cherry Doodle order."
    >
      <LegalSection heading="Where we ship">
        <p>We currently ship within India only. We do not offer international shipping at this time.</p>
      </LegalSection>
      <LegalSection heading="Dispatch time">
        <p>
          Orders are processed and dispatched within <strong>1–2 business days</strong> of successful
          payment confirmation. Business days exclude Sundays and public holidays.
        </p>
      </LegalSection>
      <LegalSection heading="Delivery time">
        <p>
          We ship through <strong>Delhivery</strong>. Once dispatched, orders are typically delivered
          within <strong>3–7 business days</strong>, depending on your delivery location. Remote
          locations may take longer.
        </p>
      </LegalSection>
      <LegalSection heading="Shipping charges">
        <p>
          Shipping charges, and any free-shipping threshold, are calculated and shown transparently in
          your cart and on the checkout page before you pay. The amount shown at checkout is the amount
          charged. Charges may change from time to time and any current promotion will be reflected at
          checkout.
        </p>
      </LegalSection>
      <LegalSection heading="Order tracking & issues">
        <p>
          If your order is delayed, undelivered, or you have any delivery concern, contact us at{" "}
          <a className="text-primary hover:underline" href={`mailto:${store.email}`}>{store.email}</a> or{" "}
          <a className="text-primary hover:underline" href={`tel:${store.phone.replace(/\s+/g, "")}`}>{store.phone}</a>{" "}
          (10:00–20:00 IST) and we will help resolve it.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
