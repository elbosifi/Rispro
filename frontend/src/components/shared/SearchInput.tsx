import { InputHTMLAttributes, forwardRef } from "react";
import { LoaderCircle, Search, X } from "lucide-react";
import { t } from "@/lib/i18n";

interface SearchInputProps extends InputHTMLAttributes<HTMLInputElement> {
  showClearButton?: boolean;
  onClear?: () => void;
  isLoading?: boolean;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className = "", showClearButton = false, onClear, isLoading = false, value, onChange, ...props }, ref) => {
    const language = props.lang === "ar" ? "ar" : "en";
    return (
      <div className="relative">
        <Search
          size={16}
          style={{
            position: "absolute",
            insetInlineStart: 12,
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--text-muted)",
            pointerEvents: "none",
          }}
        />
        <input
          ref={ref}
          type="text"
          value={value}
          onChange={onChange}
          className={`input-premium ${className}`}
          {...props}
          aria-busy={isLoading || undefined}
          style={{ ...props.style, paddingInlineStart: "2.5rem", paddingInlineEnd: (showClearButton && value) || isLoading ? "2.5rem" : undefined }}
        />
        {showClearButton && value && !isLoading && (
          <button
            type="button"
            onClick={onClear}
            aria-label={t(language, "common.clearSearch")}
            style={{
              position: "absolute",
              insetInlineEnd: 8,
              top: "50%",
              transform: "translateY(-50%)",
              background: "none",
              border: "none",
              padding: 4,
              cursor: "pointer",
              color: "var(--text-muted)",
            }}
          >
            <X size={16} />
          </button>
        )}
        {isLoading && (
          <span
            role="status"
            aria-label={t(language, "search.searching")}
            style={{
              position: "absolute",
              insetInlineEnd: 12,
              top: "50%",
              transform: "translateY(-50%)",
              fontSize: 11,
              color: "var(--text-muted)",
            }}
          >
            <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
          </span>
        )}
      </div>
    );
  }
);

SearchInput.displayName = "SearchInput";
