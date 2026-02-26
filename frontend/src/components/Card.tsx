import type { ReactNode } from "react";
import clsx from "clsx";

interface CardProps {
  children: ReactNode;
  className?: string;
  title?: string | ReactNode;
}

export function Card({ children, className, title }: CardProps) {
  return (
    <div
      className={clsx(
        "bg-white rounded-lg shadow-sm border border-gray-200",
        className
      )}
    >
      {title && (
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        </div>
      )}
      <div className={clsx(title ? "p-6" : "p-6")}>{children}</div>
    </div>
  );
}
