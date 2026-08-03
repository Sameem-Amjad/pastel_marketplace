import { Listing } from '@prisma/client';

export interface ListingResource {
  id: string;
  authorId: string;
  title: string;
  description: string | null;
  state: string;
  priceAmount: number | null;
  priceCurrency: string | null;
  listingType: string;
  categoryL1: string | null;
  categoryL2: string | null;
  categoryL3: string | null;
  condition: string | null;
  period: string | null;
  origin: string | null;
  materials: string[];
  stockType: string;
  stockQuantity: number;
  stockVersion: number;
  publicData: unknown;
  createdAt: Date;
  publishedAt: Date | null;
}

/** Public listing projection. privateData/metadata never leave the server. */
export function toListingResource(l: Listing): ListingResource {
  return {
    id: l.id,
    authorId: l.authorId,
    title: l.title,
    description: l.description,
    state: l.state,
    priceAmount: l.priceAmount === null ? null : Number(l.priceAmount),
    priceCurrency: l.priceCurrency,
    listingType: l.listingType,
    categoryL1: l.categoryL1,
    categoryL2: l.categoryL2,
    categoryL3: l.categoryL3,
    condition: l.condition,
    period: l.period,
    origin: l.origin,
    materials: l.materials,
    stockType: l.stockType,
    stockQuantity: l.stockQuantity,
    stockVersion: l.stockVersion,
    publicData: l.publicData,
    createdAt: l.createdAt,
    publishedAt: l.publishedAt,
  };
}
