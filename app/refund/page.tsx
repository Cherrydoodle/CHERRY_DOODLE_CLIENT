import type { Metadata } from "next";

import { LegalPage, LegalSection } from "@/components/legal/legal-page";
import { getStoreIdentity } from "@/features/store/identity";

export const metadata: Metadata = {
  title: "Cancellation & Refund Policy",
  description: "Cherry Doodle's order cancellation, return, and refund terms for orders in India.",
};

export default async function RefundPage() {
  const store = await getStoreIdentity();
  return (
    <LegalPage
      title="Cancellation & Refund Policy"
      intro="We want you to love your Cherry Doodle order. This policy explains when you can cancel an order, when items can be returned, and how refunds are processed."
    >
      <LegalSection heading="Order cancellation">
        <p>
          You may cancel your order any time <strong>before it is dispatched</strong>. Once an order has
          been handed to our courier for delivery, it can no longer be cancelled, but it may be eligible
          for a return under the conditions below. To cancel, contact us as soon as possible at{" "}
          <a className="text-primary hover:underline" href={`mailto:${store.email}`}>{store.email}</a>.
          If payment was already captured for a cancelled order, it is refunded in full.
        </p>
      </LegalSection>
      <LegalSection heading="Returns">
        <p>
          Products are eligible for return <strong>only if they arrived damaged</strong>. Items are not
          accepted back for change of mind, size, or preference. To qualify, the item must be reported
          within <strong>7 days</strong> of delivery and returned in its original packaging.
        </p>
        <p>
          <strong>An unboxing video is required.</strong> Please record a single, unedited video while
          opening the package — starting before the seal is broken and continuing through to the product
          being fully revealed. A return for damage can only be approved when this video clearly shows the
          damage. Without it, we are unable to process the return.
        </p>
        <p>
          To start a return, send us the unboxing video along with your <strong>order number</strong> via
          a direct message on Instagram at{" "}
          {store.instagram ? (
            <a className="text-primary hover:underline" href={store.instagram} target="_blank" rel="noopener noreferrer">
              @{store.instagram.replace(/\/+$/, "").split("/").pop()}
            </a>
          ) : (
            <span>our Instagram page</span>
          )}
          . Certain items may be marked non-returnable for hygiene or other reasons; where this applies it
          is indicated on the product page.
        </p>
      </LegalSection>
      <LegalSection heading="Return shipping">
        <p>
          For approved returns of damaged items, <strong>Cherry Doodle bears the return shipping
          cost</strong>. We will arrange the return pickup or reimburse reasonable return shipping
          charges.
        </p>
      </LegalSection>
      <LegalSection heading="Refunds">
        <p>
          Once we receive and inspect the returned item, an approved refund is initiated{" "}
          <strong>within 2 business days</strong>. Refunds are issued to your original payment method
          through our payment partner, Razorpay. After we initiate the refund, the time for it to
          appear in your account depends on your bank or card issuer.
        </p>
        <p>
          Refund amounts are always limited to the amount actually paid for the returned or cancelled
          items.
        </p>
      </LegalSection>
      <LegalSection heading="Contact">
        <p>
          For any cancellation, return, or refund request, reach us at{" "}
          <a className="text-primary hover:underline" href={`mailto:${store.email}`}>{store.email}</a> or{" "}
          <a className="text-primary hover:underline" href={`tel:${store.phone.replace(/\s+/g, "")}`}>{store.phone}</a>{" "}
          (10:00–20:00 IST).
        </p>
      </LegalSection>
    </LegalPage>
  );
}
