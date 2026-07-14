import { TextareaHTMLAttributes, forwardRef } from "react";

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className = "", ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={`input-premium min-h-[96px] resize-y ${className}`.trim()}
        {...props}
      />
    );
  }
);

Textarea.displayName = "Textarea";
