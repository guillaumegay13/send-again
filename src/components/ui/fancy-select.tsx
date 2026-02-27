import { type SelectHTMLAttributes } from "react";

interface FancySelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  wrapperClassName?: string;
}

function joinClasses(...classes: Array<string | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

const BASE_SELECT_CLASS =
  "w-full appearance-none rounded-lg border border-gray-300 bg-white px-3 pr-9 text-sm text-gray-800 shadow-sm transition-colors focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-200 disabled:cursor-not-allowed disabled:opacity-60";

export function FancySelect({
  wrapperClassName,
  className,
  children,
  ...props
}: FancySelectProps) {
  return (
    <div className={joinClasses("relative", wrapperClassName)}>
      <select {...props} className={joinClasses(BASE_SELECT_CLASS, className)}>
        {children}
      </select>
      <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-gray-400">
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          className="h-4 w-4"
        >
          <path
            d="m5.75 8 4.25 4.25L14.25 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </div>
  );
}
