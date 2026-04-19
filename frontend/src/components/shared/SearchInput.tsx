import { InputHTMLAttributes, forwardRef } from "react";
import { Search, X } from "lucide-react";

interface SearchInputProps extends InputHTMLAttributes<HTMLInputElement> {
  showClearButton?: boolean;
  onClear?: () => void;
  isLoading?: boolean;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className = "", showClearButton = false, onClear, isLoading = false, value, onChange, ...props }, ref) => {
    return (
      <div className="relative">
        <Search
          size={16}
          style={{
            position: "absolute",
            left: 12,
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
          className={`input-premium pl-8 ${showClearButton && value ? "pr-8" : ""} ${className}`}
          {...props}
        />
        {showClearButton && value && !isLoading && (
          <button
            type="button"
            onClick={onClear}
            style={{
              position: "absolute",
              right: 12,
              top: "50%",
              transform: "translateY(-50%)",
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "var(--text-muted)",
            }}
          >
            <X size={16} />
          </button>
        )}
        {isLoading && (
          <div
            style={{
              position: "absolute",
              right: 12,
              top: "50%",
              transform: "translateY(-50%)",
              fontSize: 11,
              color: "var(--text-muted)",
            }}
          >
            Searching…
          </div>
        )}
      </div>
    );
  }
);

SearchInput.displayName = "SearchInput";
