export type CollectionPurpose = "manage" | "inbox" | "library";

export interface CollectionEntry {
  slug: string;
  label: { it: string; en: string };
  description: { it: string; en: string };
  purpose: CollectionPurpose;
  editable: boolean;
}

export const COLLECTIONS: readonly CollectionEntry[] = [
  {
    slug: "bandi",
    label: { it: "Bandi e finanziamenti", en: "Tenders & funding" },
    description: {
      it: "PNRR, PON e bandi attivi per le scuole",
      en: "PNRR, PON and active tenders for schools",
    },
    purpose: "manage",
    editable: true,
  },
  {
    slug: "eventi",
    label: { it: "Eventi", en: "Events" },
    description: {
      it: "Workshop, formazioni e webinar in programma",
      en: "Workshops, training and upcoming webinars",
    },
    purpose: "manage",
    editable: true,
  },
  {
    slug: "products",
    label: { it: "Catalogo prodotti", en: "Product catalog" },
    description: {
      it: "SKU del catalogo dispositivi e laboratori",
      en: "Catalog SKUs for devices and labs",
    },
    purpose: "manage",
    editable: true,
  },
  {
    slug: "brands",
    label: { it: "Brand partner", en: "Brand partners" },
    description: {
      it: "Apple, Adobe, Google e altri brand del catalogo",
      en: "Apple, Adobe, Google and other catalog brands",
    },
    purpose: "manage",
    editable: true,
  },
  {
    slug: "product-categories",
    label: { it: "Categorie prodotto", en: "Product categories" },
    description: {
      it: "Tassonomia delle categorie del catalogo",
      en: "Catalog category taxonomy",
    },
    purpose: "manage",
    editable: true,
  },
  {
    slug: "media",
    label: { it: "Media", en: "Media" },
    description: {
      it: "Immagini e asset usati nel sito",
      en: "Images and assets used on the site",
    },
    purpose: "library",
    editable: false,
  },
  {
    slug: "contact-submissions",
    label: { it: "Richieste di contatto", en: "Contact requests" },
    description: {
      it: "Messaggi ricevuti dal form contatti",
      en: "Messages received from the contact form",
    },
    purpose: "inbox",
    editable: false,
  },
  {
    slug: "product-request-submissions",
    label: { it: "Richieste catalogo", en: "Catalog enquiries" },
    description: {
      it: "Richieste informazioni inviate dal catalogo",
      en: "Information requests from the product catalog",
    },
    purpose: "inbox",
    editable: false,
  },
] as const;

export function findCollection(slug: string): CollectionEntry | undefined {
  return COLLECTIONS.find((c) => c.slug === slug);
}
