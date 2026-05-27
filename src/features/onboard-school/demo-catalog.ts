// Demo catalog hardcoded per WS04 PoC. Phase 2: sostituire con fetch reale da
// Saleor via gateway commerce (decision-014 phase 4). Schema allineato a quello
// che ProductPicker si aspetta (slug, name, priceEur, category, imageUrl).

export interface DemoProduct {
  slug: string;
  name: string;
  priceEur: number;
  category: "zaini" | "astucci" | "diari" | "quaderni" | "accessori";
  imageUrl?: string;
}

export const DEMO_CATALOG: DemoProduct[] = [
  {
    slug: "zaino-classic-blu",
    name: "Zaino Classic Blu",
    priceEur: 49.9,
    category: "zaini",
  },
  {
    slug: "zaino-tech-grafite",
    name: "Zaino Tech Grafite",
    priceEur: 69.0,
    category: "zaini",
  },
  {
    slug: "astuccio-3-zip-rosso",
    name: "Astuccio 3 Zip Rosso",
    priceEur: 24.5,
    category: "astucci",
  },
  {
    slug: "diario-12-mesi-2026",
    name: "Diario 12 Mesi 2026/27",
    priceEur: 14.9,
    category: "diari",
  },
  {
    slug: "quaderno-a4-rigo-1r",
    name: "Quaderno A4 Rigo 1R (10 pz)",
    priceEur: 18.0,
    category: "quaderni",
  },
  {
    slug: "borraccia-termica-500ml",
    name: "Borraccia Termica 500ml",
    priceEur: 16.5,
    category: "accessori",
  },
];
