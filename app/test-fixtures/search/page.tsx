"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Search, ShoppingBag } from "lucide-react";

interface Product {
  id: string;
  title: string;
  price: string;
  category: string;
  rating: number;
}

const ALL_PRODUCTS: Product[] = [
  { id: "p-1", title: "Laptop Pro 16", price: "₹75,000", category: "Laptops", rating: 4.8 },
  { id: "p-2", title: "Laptop Air 13", price: "₹65,000", category: "Laptops", rating: 4.6 },
  { id: "p-3", title: "Gaming Laptop Ultra", price: "₹90,000", category: "Laptops", rating: 4.9 },
  { id: "p-4", title: "Wireless Noise-Canceling Headphones", price: "₹4,500", category: "Audio", rating: 4.5 },
  { id: "p-5", title: "Mechanical Keyboard RGB", price: "₹3,200", category: "Peripherals", rating: 4.7 },
  { id: "p-6", title: "Classic School Backpack", price: "₹699", category: "Bags", rating: 4.4 },
  { id: "p-7", title: "Ergonomic Kids School Bag", price: "₹899", category: "Bags", rating: 4.6 },
  { id: "p-8", title: "Waterproof Student School Bag", price: "₹1,299", category: "Bags", rating: 4.7 },
];

export default function SearchFixturePage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  React.useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const allQ = params.getAll("q");
      const activeQ = allQ.filter(Boolean).pop() || params.get("q") || "";
      if (activeQ) {
        setSearchTerm(activeQ);
        setSubmittedQuery(activeQ);
      }
    }
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = searchTerm.trim();
    setSubmittedQuery(clean);
    setSelectedProduct(null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("q", clean);
      window.history.replaceState({}, "", url.toString());
    }
  };

  const filtered = submittedQuery
    ? ALL_PRODUCTS.filter((p) => {
        const q = submittedQuery.toLowerCase();
        const words = q.split(/\s+/).filter((w) => !["cheapest", "most", "expensive", "best", "the", "for", "bags"].includes(w));
        if (q.includes("school") && p.title.toLowerCase().includes("school")) return true;
        if (words.length > 0 && words.every((w) => p.title.toLowerCase().includes(w) || p.category.toLowerCase().includes(w))) {
          return true;
        }
        return p.title.toLowerCase().includes(q) || p.category.toLowerCase().includes(q);
      })
    : ALL_PRODUCTS;

  return (
    <div className="min-h-screen bg-[#F7FAFC] p-8 max-w-4xl mx-auto font-sans">
      <div className="flex items-center justify-between border-b border-[#D9E8EF] pb-4 mb-6">
        <div>
          <Link href="/test-fixtures" className="text-xs text-[#4F8EAD] hover:underline mb-1 inline-block">
            ← All Fixtures
          </Link>
          <h1 className="text-xl font-bold text-[#24485A] flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-[#4F8EAD]" /> Product Search Demo Shop
          </h1>
        </div>
        <span className="text-xs font-mono bg-[#EEF6FB] text-[#24485A] px-2.5 py-1 rounded border border-[#D9E8EF]">
          Fixture: /test-fixtures/search
        </span>
      </div>

      {/* Search Input Section with controlled hidden duplicate 'q' */}
      <div className="bg-[#FFFFFF] border border-[#D9E8EF] rounded-lg p-5 shadow-card mb-6">
        <form onSubmit={handleSearch} className="flex gap-2.5">
          {/* Controlled hidden duplicate element named 'q' representing hidden inputs in real-world forms */}
          <input type="hidden" name="q" value="" />
          <div className="relative flex-1">
            <input
              type="text"
              name="q"
              id="search-input"
              data-testid="search-input"
              aria-label="Search products"
              placeholder="Search products (e.g. laptop)..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-3 pr-3 py-2 bg-[#FFFFFF] border border-[#D9E8EF] rounded-md text-sm text-[#1F2933] placeholder-[#667784] focus:outline-none focus:border-[#6FA8C5] focus:ring-1 focus:ring-[#6FA8C5]"
            />
          </div>
          <button
            type="submit"
            className="px-5 py-2 bg-[#4F8EAD] hover:bg-[#437B96] text-white text-sm font-medium rounded-md transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <Search className="w-4 h-4" /> Search
          </button>
        </form>
      </div>

      {/* Search Results */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#24485A]">
            {submittedQuery ? `Results for "${submittedQuery}" (${filtered.length})` : `All Products (${filtered.length})`}
          </h2>
        </div>

        {filtered.length === 0 ? (
          <div className="bg-[#FFFFFF] border border-[#D9E8EF] rounded-lg p-8 text-center text-xs text-[#667784]">
            No products found matching &quot;{submittedQuery}&quot;. Try searching for &quot;laptop&quot;.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtered.map((product, idx) => (
              <div
                key={product.id}
                className="product-card bg-[#FFFFFF] border border-[#D9E8EF] rounded-lg p-4 shadow-card hover:border-[#6FA8C5] transition-all flex flex-col justify-between"
                data-testid={`product-card-${idx}`}
              >
                <div>
                  <div className="flex justify-between items-start gap-2">
                    <h3 className="text-sm font-bold text-[#24485A] product-title">{product.title}</h3>
                    <span className="text-xs bg-[#EEF6FB] text-[#24485A] font-semibold px-2 py-0.5 rounded border border-[#D9E8EF]">
                      ★ {product.rating}
                    </span>
                  </div>
                  <div className="text-base font-bold text-[#5F9E7A] mt-2 product-price">
                    {product.price}
                  </div>
                  <div className="text-xs text-[#667784] mt-1">{product.category}</div>
                </div>

                <div className="mt-4 pt-3 border-t border-[#D9E8EF] flex items-center justify-between">
                  <button
                    onClick={() => setSelectedProduct(product)}
                    className="text-xs text-[#4F8EAD] hover:underline font-medium"
                  >
                    View Details
                  </button>
                  <button
                    onClick={() => setSelectedProduct(product)}
                    className="px-3 py-1 bg-[#EEF6FB] hover:bg-[#E3F1F8] text-[#24485A] text-xs font-semibold rounded border border-[#D9E8EF] transition-colors"
                  >
                    Select Product
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Selected Product Modal/Detail View */}
      {selectedProduct && (
        <div className="mt-6 p-4 bg-[#EEF6FB] border border-[#D9E8EF] rounded-lg space-y-2" id="product-detail-view">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-bold text-[#24485A]">Active Product Selection</h3>
            <button
              onClick={() => setSelectedProduct(null)}
              className="text-xs text-[#667784] hover:text-[#24485A]"
            >
              Close
            </button>
          </div>
          <p className="text-xs text-[#1F2933]">
            Selected: <strong className="product-title">{selectedProduct.title}</strong> at price <strong className="product-price">{selectedProduct.price}</strong>
          </p>
        </div>
      )}
    </div>
  );
}
