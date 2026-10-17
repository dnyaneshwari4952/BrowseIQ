import { NextRequest, NextResponse } from "next/server";

export interface ProductItem {
  id: string;
  title: string;
  price: string;
  category: string;
  inStock: boolean;
  description: string;
}

const PRODUCTS_DATABASE: ProductItem[] = [
  {
    id: "prod-1",
    title: "Laptop Pro",
    price: "₹75,000",
    category: "laptop",
    inStock: true,
    description: "High-performance laptop with 16GB RAM, 512GB NVMe SSD, M-series chip",
  },
  {
    id: "prod-2",
    title: "Laptop Air",
    price: "₹65,000",
    category: "laptop",
    inStock: true,
    description: "Ultra-slim lightweight laptop with all-day battery life",
  },
  {
    id: "prod-3",
    title: "Gaming Laptop",
    price: "₹90,000",
    category: "laptop",
    inStock: true,
    description: "RTX 4070, 32GB RAM, 144Hz IPS display",
  },
  {
    id: "prod-4",
    title: "Wireless Mouse",
    price: "₹1,499",
    category: "accessories",
    inStock: true,
    description: "Ergonomic 2.4GHz wireless optical mouse",
  },
  {
    id: "prod-5",
    title: "Mechanical Keyboard",
    price: "₹4,999",
    category: "accessories",
    inStock: true,
    description: "RGB mechanical keyboard with hot-swappable switches",
  },
];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") || searchParams.get("query") || "").toLowerCase().trim();
  const simulateError = searchParams.get("simulateError");

  if (simulateError === "500") {
    return NextResponse.json({ error: "Internal Server Error in Product API" }, { status: 500 });
  }
  if (simulateError === "401") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (simulateError === "429") {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  if (!query) {
    return NextResponse.json({
      success: true,
      total: PRODUCTS_DATABASE.length,
      products: PRODUCTS_DATABASE,
    });
  }

  const stemmedQuery = query.replace(/s$/, "");

  const matches = PRODUCTS_DATABASE.filter(
    (p) =>
      p.title.toLowerCase().includes(query) ||
      p.category.toLowerCase().includes(query) ||
      p.description.toLowerCase().includes(query) ||
      p.title.toLowerCase().includes(stemmedQuery) ||
      p.category.toLowerCase().includes(stemmedQuery)
  );

  return NextResponse.json({
    success: true,
    query,
    total: matches.length,
    products: matches,
  });
}
