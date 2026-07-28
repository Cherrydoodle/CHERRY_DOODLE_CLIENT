import type { ColorDTO, ProductSummaryDTO } from "@/features/catalog/types";

export type CartDTO = {
  id: string | null;
  owner: "guest" | "user";
  items: Array<{
    id: string;
    quantity: number;
    variant: { id: string; sku: string; label: string; color: ColorDTO };
    product: ProductSummaryDTO;
    unitPriceCents: number;
    lineTotalCents: number;
    originalLineTotalCents: number;
    warning: "price_changed" | "out_of_stock" | "quantity_reduced" | null;
  }>;
  summary: {
    currency: string;
    itemCount: number;
    subtotalBeforeDiscountCents: number;
    discountCents: number;
    subtotalCents: number;
    shippingCents: number;
    freeShippingThresholdCents: number;
    freeShippingRemainingCents: number;
    totalCents: number;
  };
  updatedAt: string | null;
};
