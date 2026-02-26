import { Link, useLocation } from "react-router-dom";
import { UnitToggle } from "./UnitToggle";
import { useUIStore } from "../store/uiStore";
import clsx from "clsx";

export function NavBar() {
  const location = useLocation();
  const fyYear = useUIStore((s) => s.fyYear);

  const navLinks = [
    { path: "/", label: "Dashboard" },
    { path: "/invoices", label: "Invoices" },
    { path: "/items", label: "Items" },
    { path: "/orders", label: "Orders" },
    { path: "/import", label: "Import" },
    { path: "/settings", label: "Settings" },
  ];

  const isActive = (path: string) => {
    if (path === "/") {
      return location.pathname === "/";
    }
    return location.pathname.startsWith(path);
  };

  return (
    <nav className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-8">
            <Link to="/" className="flex items-center gap-2 text-xl font-bold text-gray-900">
              <span className="text-2xl">🚲</span>
              <span>MK CYCLES</span>
            </Link>
            <div className="flex gap-1">
              {navLinks.map((link) => (
                <Link
                  key={link.path}
                  to={link.path}
                  className={clsx(
                    "px-4 py-2 text-sm font-medium rounded-md transition-colors",
                    isActive(link.path)
                      ? "bg-blue-50 text-blue-700"
                      : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                  )}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <UnitToggle />
            <div className="text-sm font-medium text-gray-600">
              FY {fyYear}-{(fyYear + 1).toString().slice(-2)}
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
