import { createContext, useContext, useMemo, type HTMLAttributes, type ReactNode } from "react";

interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs() {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error("Tabs components must be used within Tabs");
  }
  return context;
}

interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
}

export function Tabs({ value, onValueChange, children }: TabsProps) {
  const context = useMemo(() => ({ value, onValueChange }), [value, onValueChange]);
  return <TabsContext.Provider value={context}>{children}</TabsContext.Provider>;
}

export function TabsList({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`tabs-shell ${className}`.trim()} {...props} />;
}

export function TabsTrigger({
  value,
  className = "",
  children,
  ...props
}: HTMLAttributes<HTMLButtonElement> & { value: string }) {
  const tabs = useTabs();
  const active = tabs.value === value;
  return (
    <button
      type="button"
      data-state={active ? "active" : "inactive"}
      className={`tabs-trigger ${className}`.trim()}
      onClick={() => tabs.onValueChange(value)}
      {...props}
    >
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  className = "",
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { value: string }) {
  const tabs = useTabs();
  if (tabs.value !== value) return null;
  return (
    <div className={className} {...props}>
      {children}
    </div>
  );
}
