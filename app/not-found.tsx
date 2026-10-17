import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center bg-slate-50 text-slate-900">
      <h2 className="text-3xl font-bold tracking-tight mb-3">404 - Page Not Found</h2>
      <p className="text-slate-600 mb-6">The requested resource could not be found.</p>
      <Link
        href="/"
        className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
      >
        Return to Agent Dashboard
      </Link>
    </div>
  );
}
