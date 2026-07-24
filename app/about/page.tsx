import type { Metadata } from "next";

import { LegalPage, LegalSection } from "@/components/legal/legal-page";
import { getStoreIdentity } from "@/features/store/identity";

export const metadata: Metadata = {
  title: "About Us",
  description: "Cherry Doodle is an India-based online store for cute, pastel Korean-style stationery.",
};

export default async function AboutPage() {
  const store = await getStoreIdentity();
  return (
    <LegalPage
      title="About Cherry Doodle"
      intro="Cherry Doodle is a small, independent stationery brand based in India. We curate and sell cute, pastel Korean-style stationery — gel pens, stickers, notebooks, and everyday lifestyle accessories made to bring a little joy to journaling, studying, and gifting."
    >
      <LegalSection heading="Who we are">
        <p>
          Cherry Doodle is operated as an individual proprietorship in India. We are the merchant of
          record for every product we list; orders are fulfilled and shipped by us directly to
          customers across India.
        </p>
      </LegalSection>
      <LegalSection heading="What we sell">
        <p>
          Physical stationery and lifestyle goods — gel pens, sticker sets, notebooks and memo pads,
          washi tape, and cute desk accessories. Every item is priced in Indian Rupees (INR) and is
          purchasable directly on this website.
        </p>
      </LegalSection>
      <LegalSection heading="How to reach us">
        <p>
          Email: <a className="text-primary hover:underline" href={`mailto:${store.email}`}>{store.email}</a>
          <br />
          Phone: <a className="text-primary hover:underline" href={`tel:${store.phone.replace(/\s+/g, "")}`}>{store.phone}</a>
          <br />
          Support hours: 10:00–20:00 IST, all days.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
